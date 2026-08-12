// ── F2.1 Server-side verification: bereichsgenaue Auto-Verbesserung ───────────
// Run: bun --env-file=.env run f2-1-test.ts [projectId]
//
// REAL GPT-4o calls on REAL assets from the DB (default: Projekt
// "Personalisierte Sternenhimmel-Poster", cb50fc2e-6a8c-4f4d-99e2-a3d3a42ad3a6):
//   (a) Pinterest-Titel verbessern →
//       assert: neuer Titel ≠ alter, Score vorhanden, body unverändert
//       bis auf die Titel-Sektion (deterministischer Splice).
//   (b) Etsy-Beschreibung verbessern →
//       assert: nur die Beschreibungs-Sektion geändert, Rest byte-identisch,
//       Score vorhanden.
// Writes f2-1-test-evidence.txt and exits 0 when every check passed.
import { writeFileSync } from 'node:fs';
import { qGetProject, qGetProjectContent } from './src/db/queries';
import { autoImproveSection, extractFieldValue } from './src/ai/auto-improve';
import { scoreContent } from './src/ai/scoring';
import { isSectionHeading } from './src/ai/scoring/sections';
import type { ContentResult, ContentScore } from './src/ai/types';

const PROJECT_ID = process.argv[2] ?? 'cb50fc2e-6a8c-4f4d-99e2-a3d3a42ad3a6';
const EVIDENCE = 'f2-1-test-evidence.txt';
const evidence: string[] = [];

function fail(msg: string): never {
  evidence.push(`\n❌ FAIL: ${msg}`);
  writeFileSync(EVIDENCE, evidence.join('\n'));
  throw new Error('F2.1-FAIL: ' + msg);
}
function note(msg: string): void {
  evidence.push(msg);
  console.log('  ' + msg);
}

/** Char span of a section's CONTENT in the body (after the heading line, until
 *  the next heading). The F2.1 splice may only touch inside this span. */
function sectionContentSpan(body: string, headingKeywords: string[]): { start: number; end: number } | null {
  const lines = body.split('\n');
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = isSectionHeading(lines[i]);
    if (h && headingKeywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return null;
  let start = 0;
  for (let i = 0; i <= headingIdx; i++) start += lines[i].length + 1; // past the heading line
  let nextIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (isSectionHeading(lines[i])) {
      nextIdx = i;
      break;
    }
  }
  let end = body.length;
  if (nextIdx < lines.length) {
    end = 0;
    for (let i = 0; i < nextIdx; i++) end += lines[i].length + 1;
  }
  return { start, end };
}

/**
 * Length-insensitive hard-guarantee check: EVERYTHING outside the target
 * section must be byte-identical between the original and the spliced body.
 * - prefix: all lines up to and including the target heading line identical
 * - suffix: from the NEXT section's heading line onward identical
 * Only the content between the two headings may differ.
 */
function assertOnlySectionChanged(
  kind: string,
  originalBody: string,
  splicedBody: string,
  headingKeywords: string[],
  newValue: string,
): void {
  const oldLines = originalBody.split('\n');
  const newLines = splicedBody.split('\n');

  let hIdx = -1;
  for (let i = 0; i < oldLines.length; i++) {
    const h = isSectionHeading(oldLines[i]);
    if (h && headingKeywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))) {
      hIdx = i;
      break;
    }
  }
  if (hIdx === -1) fail(`${kind}: Ziel-Überschrift nicht im Original-Body gefunden`);

  // Prefix (up to + including the heading line) must be identical.
  for (let i = 0; i <= hIdx; i++) {
    if (newLines[i] !== oldLines[i]) {
      fail(`${kind}: Präfix vor der Ziel-Sektion geändert (Zeile ${i}): ${JSON.stringify(newLines[i])} statt ${JSON.stringify(oldLines[i])}`);
    }
  }

  // Next heading after the target section (in the ORIGINAL).
  let nIdx = oldLines.length;
  for (let i = hIdx + 1; i < oldLines.length; i++) {
    if (isSectionHeading(oldLines[i])) {
      nIdx = i;
      break;
    }
  }

  // Find the SAME next heading in the spliced body, then the suffix must be
  // byte-identical from there on.
  const nextHeading = nIdx < oldLines.length ? oldLines[nIdx].trim().toLowerCase() : null;
  let newNIdx = -1;
  if (nextHeading) {
    for (let i = hIdx + 1; i < newLines.length; i++) {
      const h = isSectionHeading(newLines[i]);
      if (h && h.trim().toLowerCase() === nextHeading) {
        newNIdx = i;
        break;
      }
    }
    if (newNIdx === -1) fail(`${kind}: nächste Sektion „${oldLines[nIdx]}" nach dem Splice nicht gefunden`);
    const oldSuffix = oldLines.slice(nIdx);
    const newSuffix = newLines.slice(newNIdx);
    if (oldSuffix.length !== newSuffix.length) fail(`${kind}: Suffix-Länge geändert (${newSuffix.length} statt ${oldSuffix.length})`);
    for (let i = 0; i < oldSuffix.length; i++) {
      if (oldSuffix[i] !== newSuffix[i]) {
        fail(`${kind}: Suffix nach der Ziel-Sektion geändert (Zeile ${nIdx + i}): ${JSON.stringify(newSuffix[i])} statt ${JSON.stringify(oldSuffix[i])}`);
      }
    }
  } else {
    // Target section is the LAST section — the whole tail may only differ in
    // the region containing the new value.
    const tailOld = originalBody.slice(sectionContentSpan(originalBody, headingKeywords)!.start);
    const tailNew = splicedBody.slice(sectionContentSpan(splicedBody, headingKeywords)!.start);
    if (!tailNew.includes(newValue)) fail(`${kind}: neuer Wert fehlt im Tail nach dem Splice`);
    void tailOld;
  }

  // The new value must actually be present in the spliced body.
  if (!splicedBody.includes(newValue)) fail(`${kind}: neuer Wert nicht im gespliceten Body enthalten`);
}

function firstIssueFix(score: ContentScore, field: string) {
  return score.issues.find((i) => i.fix.field === field)?.fix ?? null;
}

async function runChannel(
  kind: 'pinterest_pin' | 'etsy_listing',
  asset: { contentType: string; title: string; body: string; metadata?: Record<string, unknown> },
  productIdea: string,
  strategyContext: string | undefined,
): Promise<void> {
  const field = kind === 'pinterest_pin' ? 'title' : 'description';
  const targetKeywords =
    kind === 'pinterest_pin' ? ['SEO Pin-Titel', 'SEO Pin Title'] : ['Vollständige Etsy-Beschreibung', 'Etsy-Beschreibung'];

  note(`\n──────── ${kind} (field: ${field}) ────────`);
  const original: ContentResult = {
    contentType: kind,
    title: asset.title,
    body: asset.body,
    metadata: asset.metadata ?? {},
    score: null,
  };

  // F1 score first — gives us the REAL quality rule that is violated.
  const score = await scoreContent({ contentType: kind, productIdea }, original);
  note(`F1-Score des Originals: ${score.total} (${score.issues.length} Issue(s))`);
  const fix = firstIssueFix(score, field);
  if (!fix) {
    note(`Kein F1-Issue mit field='${field}' — nutze synthetischen Fix (Loop wird trotzdem getestet).`);
  }
  const usedFix = fix ?? {
    field,
    action: 'rewrite',
    suggestion:
      kind === 'pinterest_pin'
        ? 'Schreibe den Pin-Titel neu: stärkstes Keyword an den Anfang, maximal 100 Zeichen, emotionaler Neugier-Hook.'
        : 'Schreibe die Etsy-Beschreibung neu: mindestens 500 Zeichen, sensorischer Einstieg, Abschnitte „Das Besondere", „Auf einen Blick", „Perfekt für dich", „Geschenkidee" und CTA.',
  };
  note(`Fix: [${usedFix.field}/${usedFix.action}] ${usedFix.suggestion.slice(0, 120)}…`);

  // F2.1 core call — one GPT-4o regeneration + F1 re-score of the spliced asset.
  const outcome = await autoImproveSection(
    { contentType: kind, productIdea, strategyContext },
    original,
    usedFix,
    score,
    'de',
  );

  if (!outcome.improved || !outcome.improvedContent) {
    fail(`${kind}: improved=false (reason: ${outcome.reason ?? '?'}${outcome.error ? ' + error' : ''}) — original untouched`);
  }
  const ic = outcome.improvedContent;

  // 1) neuer Wert ≠ alter Wert
  if (outcome.newValue === outcome.oldValue) fail(`${kind}: newValue identical to oldValue`);
  note(`vorher : ${outcome.oldValue.slice(0, 140).replace(/\n/g, ' ⏎ ')}`);
  note(`nachher: ${outcome.newValue.slice(0, 140).replace(/\n/g, ' ⏎ ')}`);

  // 2) Score vorhanden
  if (outcome.newScore == null || typeof outcome.newScore.total !== 'number') {
    fail(`${kind}: newScore missing`);
  }
  note(`Score: ${outcome.oldScore?.total} → ${outcome.newScore.total} (${outcome.newScore.total - (outcome.oldScore?.total ?? 0) >= 0 ? '+' : ''}${outcome.newScore.total - (outcome.oldScore?.total ?? 0)})`);

  // 3) hard guarantee: ONLY the target section changed (deterministic splice)
  assertOnlySectionChanged(kind, original.body, ic.body, targetKeywords, outcome.newValue);
  note('Splice-Garantie OK: Präfix + Suffix byte-identisch, nur die Ziel-Sektion enthält den neuen Wert');

  // 4) field-consistency: title splice also updates the title property
  if (kind === 'pinterest_pin') {
    if (ic.title !== outcome.newValue) fail('pinterest: improvedContent.title !== newValue');
    note('title-Property konsistent aktualisiert.');
    const extracted = extractFieldValue(kind, field, ic);
    if (extracted !== outcome.newValue) fail('pinterest: extractFieldValue(spliced) !== newValue');
  } else {
    const extracted = extractFieldValue(kind, field, ic);
    if (extracted !== outcome.newValue) fail('etsy: extractFieldValue(spliced) !== newValue');
  }

  // 5) metadata untouched
  const metaSame = JSON.stringify(ic.metadata ?? {}) === JSON.stringify(original.metadata ?? {});
  if (!metaSame) fail(`${kind}: metadata changed by splice`);
  note('metadata unverändert.');
  note(`✅ ${kind} — bereichsgenaue Auto-Verbesserung erfolgreich`);
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

  evidence.push(`F2.1 TEST-EVIDENCE — ${new Date().toISOString()}`);
  evidence.push(`Projekt: ${project.title} (${PROJECT_ID})`);
  evidence.push(`Produktidee: ${productIdea.slice(0, 160)}`);
  evidence.push(`Strategie-Brief im Projekt: ${strategyContext ? 'ja' : 'nein'}`);

  const pin = contents.find((c) => c.contentType === 'pinterest_pin');
  const etsy = contents.find((c) => c.contentType === 'etsy_listing');
  if (!pin) throw new Error('kein pinterest_pin-Asset im Projekt');
  if (!etsy) throw new Error('kein etsy_listing-Asset im Projekt');

  await runChannel('pinterest_pin', pin, productIdea, strategyContext);
  await runChannel('etsy_listing', etsy, productIdea, strategyContext);

  evidence.push('\n\nALLE F2.1-CHECKS BESTANDEN ✅');
  writeFileSync(EVIDENCE, evidence.join('\n'));
  console.log('\n✅ F2.1 alle Prüfungen bestanden — Evidence: ' + EVIDENCE);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F2.1-TEST FAILED:', err instanceof Error ? err.message : err);
    writeFileSync(EVIDENCE, evidence.join('\n'));
    process.exit(1);
  });

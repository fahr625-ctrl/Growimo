// ─────────────────────────────────────────────────────────────────────────────
// Prüfpunkt 2026-11-17: „Kein KI-Anbieter eingerichtet" ≠ „Kein brauchbares
// Ergebnis".
//
// Belegter Fall (Vorschau, Vercel-Target Preview ohne OPENAI_API_KEY): Der Lauf
// bricht mit `[generate] Configured providers: 0` ab, der Nutzer sah aber nur
// `results_quality_failed_title` („Kein brauchbares Ergebnis") — also den
// Eindruck, sein Prompt sei schuld. Dieser Test verankert, dass
//   A) der echte Serverpfad in diesem Fall einen TYPISIERTEN Fehler wirft,
//   B) der Stream ihn als eigenes Ereignis mit Code durchreicht,
//   C) echte Qualitätsfehler (Absage/unvollständig) ihre bisherige Meldung
//      behalten und NICHT als „Anbieter fehlt" gelten,
//   D) die Oberfläche dafür einen eigenen Hinweis mit Betreiber-Zeile rendert
//      und den Qualitäts-Banner in diesem Fall unterdrückt.
//
// Kein Anbieteraufruf, keine DB, keine Kosten: OPENAI_API_KEY wird im Test
// explizit entfernt (Bun lädt sonst die .env der Repo-Wurzel).
//
//   bun run provider-nicht-konfiguriert-test.ts
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { generateContent } from './src/ai/generate';
import { runStrategyStream } from './src/ai/stream';
import type { StreamEvent } from './src/ai/stream';
import type { ContentRequest } from './src/ai/types';
import { GenerationQualityError } from './src/lib/result-quality';
import {
  PROVIDER_NOT_CONFIGURED_CODE,
  PROVIDER_NOT_CONFIGURED_MARKER,
  isProviderNotConfigured,
  isProviderNotConfiguredMessage,
} from './src/lib/provider-not-configured';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, label: string, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const request: ContentRequest = {
  contentType: 'pinterest_pin',
  productIdea: 'Handgemachte Kerzen aus Sojawachs für kleine Wohnungen',
} as ContentRequest;

async function main() {
  // Ausgangslage herstellen: KEIN Schlüssel in dieser Umgebung.
  delete process.env.OPENAI_API_KEY;
  check(!process.env.OPENAI_API_KEY, '[0] Ausgangslage: kein OPENAI_API_KEY gesetzt');

  // ── A) Echter Serverpfad: typisierter Fehler statt „kein Ergebnis" ─────────
  let thrown: unknown = null;
  try {
    await generateContent(request);
  } catch (err) {
    thrown = err;
  }
  check(thrown !== null, '[A1] generateContent wirft ohne Schlüssel einen Fehler');
  check(
    (thrown as { code?: unknown })?.code === PROVIDER_NOT_CONFIGURED_CODE,
    `[A2] Fehler trägt den Code ${PROVIDER_NOT_CONFIGURED_CODE}`,
    String((thrown as { code?: unknown })?.code),
  );
  check(isProviderNotConfigured(thrown), '[A3] isProviderNotConfigured erkennt ihn');
  check(
    typeof (thrown as Error)?.message === 'string' &&
      (thrown as Error).message.includes(PROVIDER_NOT_CONFIGURED_MARKER),
    '[A4] technische Meldung trägt den Marker (Konsole/Protokoll)',
    String((thrown as Error)?.message),
  );

  // ── B) Stream: eigenes Ereignis mit Code, kein Ergebnis ────────────────────
  const events: StreamEvent[] = [];
  await runStrategyStream([request], (ev) => {
    events.push(ev);
    return true;
  });
  const errorEvent = events.find((e) => e.type === 'error') as
    | { type: 'error'; code?: string; message: string }
    | undefined;
  check(!!errorEvent, '[B1] Stream meldet ein error-Ereignis');
  check(
    errorEvent?.code === PROVIDER_NOT_CONFIGURED_CODE,
    `[B2] Stream-Ereignis trägt den Code ${PROVIDER_NOT_CONFIGURED_CODE}`,
    String(errorEvent?.code),
  );
  check(
    isProviderNotConfiguredMessage(errorEvent?.message),
    '[B3] Client-Erkennung greift auf der Stream-Meldung (Marker-Rückfallebene)',
    String(errorEvent?.message),
  );
  check(
    !events.some((e) => e.type === 'result'),
    '[B4] es wird kein Ergebnis geliefert (nichts als Erfolg gemeldet)',
  );

  // ── C) Gegenprobe: echte Qualitätsfehler behalten ihre Meldung ─────────────
  const refusal = new GenerationQualityError('refusal', ['Q5']);
  const incomplete = new GenerationQualityError('incomplete', []);
  check(!isProviderNotConfigured(refusal), '[C1] Absage gilt NICHT als „Anbieter fehlt"');
  check(!isProviderNotConfigured(incomplete), '[C2] Unvollständig gilt NICHT als „Anbieter fehlt"');
  check(
    !isProviderNotConfiguredMessage(refusal.message),
    '[C3] Qualitätsmeldung wird nicht fälschlich als Anbieter-Fehler erkannt',
    refusal.message,
  );
  check(
    isProviderNotConfigured({ code: PROVIDER_NOT_CONFIGURED_CODE }) &&
      !isProviderNotConfigured({ code: 'REFUSAL' }),
    '[C4] Code-Erkennung über die Transportgrenze (nur der eigene Code zählt)',
  );

  // ── D) Oberfläche + i18n: eigener Hinweis, Qualitäts-Banner unterdrückt ────
  const source = readFileSync('./src/routes/app/new-project.tsx', 'utf8');
  check(
    source.includes('data-testid="provider-missing-banner"'),
    '[D1] eigener Hinweis-Banner existiert (data-testid="provider-missing-banner")',
  );
  check(
    source.includes('failedTypes.length > 0 && !providerMissing'),
    '[D2] „Kein brauchbares Ergebnis" erscheint NICHT, wenn der Anbieter fehlt',
  );
  check(
    source.includes('setProviderMissing(true)') &&
      source.includes('isProviderNotConfiguredMessage(event.message)'),
    '[D3] Stream-Pfad setzt die Anbieter-Ursache (Marker/Code), nicht den Qualitätsfall',
  );
  check(
    source.includes('isProviderNotConfigured(error)'),
    '[D4] äußerer Fehlerpfad (ServerFn/Netz) erkennt die Anbieter-Ursache',
  );
  check(
    source.includes('{t.results_provider_missing_title}') &&
      source.includes('{t.results_provider_missing_body}') &&
      source.includes('{t.results_provider_missing_operator_hint}'),
    '[D5] der Banner nutzt die neuen i18n-Schlüssel (inkl. Betreiber-Zeile)',
  );
  const deT = de as unknown as Record<string, string>;
  const enT = en as unknown as Record<string, string>;
  for (const key of [
    'results_provider_missing_title',
    'results_provider_missing_body',
    'results_provider_missing_operator_hint',
  ]) {
    check(
      typeof deT[key] === 'string' && deT[key].length > 0,
      `[D6] de.${key} vorhanden`,
    );
    check(
      typeof enT[key] === 'string' && enT[key].length > 0,
      `[D7] en.${key} vorhanden`,
    );
  }
  check(
    deT.results_provider_missing_title !== deT.results_quality_failed_title,
    '[D8] die neue Meldung ist nicht die alte Qualitäts-Meldung',
  );
  check(
    deT.results_quality_failed_title === 'Kein brauchbares Ergebnis',
    '[D9] echte Qualitätsfehler behalten ihre bisherige Meldung',
    deT.results_quality_failed_title,
  );

  console.log(`\n${passed} grün, ${failed} rot`);
  if (failed > 0) {
    console.log('Fehlgeschlagen:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Testlauf abgebrochen:', err);
  process.exit(1);
});

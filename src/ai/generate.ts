import type { AIConfig, ContentRequest, ContentResult } from './types';
import { getConfiguredProviders } from './providers/index';

/**
 * Runs one provider call (explicit config first, then the configured provider).
 * Never silently falls back to placeholder/demo content: without a configured AI
 * provider the user must see a clear error, not fake output.
 */
async function runProvider(
  request: ContentRequest,
  config?: AIConfig,
): Promise<ContentResult> {
  console.log('[generate] Request:', JSON.stringify(request));
  if (config) {
    const { getProvider } = await import('./providers/index');
    const provider = getProvider(config.provider);
    console.log('[generate] Using explicit provider:', config.provider, 'configured:', provider.isConfigured());
    if (provider.isConfigured()) {
      return provider.generate(request, config);
    }
  }
  const configured = getConfiguredProviders();
  console.log('[generate] Configured providers:', configured.length);
  if (configured.length > 0) {
    const providerConfig: AIConfig = config ?? { provider: 'openai' };
    console.log('[generate] Using provider:', configured[0].name);
    return configured[0].generate(request, providerConfig);
  }
  throw new Error(
    'Kein KI-Anbieter konfiguriert. Bitte OPENAI_API_KEY in den Umgebungsvariablen setzen, um Inhalte zu generieren.',
  );
}

/** Post-Processing, das für JEDEN generierten Kanal gilt (Metric-Guard + Score). */
async function finish(request: ContentRequest, result: ContentResult): Promise<ContentResult> {
  return attachScore(request, await applyMetricGuard(request, result));
}

export interface ContextLoyaltyRun {
  /** Die akzeptierte Ausgabe (nie eine mit unbegründetem Growimo-Selbstbezug). */
  result: ContentResult;
  /** Anzahl der Provider-Aufrufe (1 = ok beim ersten Versuch). */
  attempts: number;
  /** true = erst der korrigierte Versuch war konform. */
  corrected: boolean;
}

/**
 * Phase 4.2 (Stabilisierung, C1/C2) — Kontexttreue als harter Post-Check.
 *
 * Läuft zentral hier (nicht in einzelnen Aufrufern) und deckt damit ALLE
 * Kanäle ab: Einzel-Asset (QuickGenerator), Projekt-Flow (new-project),
 * Verbessern (improve), Strategie-Stream (stream.ts) und Paket-Flow
 * (package/package.ts) nutzen alle `generateContent`.
 *
 * Verhalten bei unbegründeter Growimo-Selbstthematisierung:
 *   1. EIN korrigierender Versuch mit explizitem Korrektur-Hinweis im Prompt.
 *   2. Bleibt der Verstoß, wird NICHTS still geliefert: es fliegt ein ehrlicher
 *      Fehler (`CONTEXT_LOYALTY_ERROR`). Der Usage-Guard kompensiert den
 *      Zähler bei Fehlern (Zähler -1), der Nutzer verliert also keine
 *      Generierung (Phase 8.2: „nur verbrauchen, wenn erfolgreich").
 *
 * Der Provider-Aufruf ist injizierbar (`run`) — damit ist die Retry-/Reject-
 * Logik ohne Netzwerk testbar (stabilisierung-phase4-test.ts).
 */
export async function runWithContextLoyalty(
  request: ContentRequest,
  run: (req: ContentRequest) => Promise<ContentResult>,
): Promise<ContextLoyaltyRun> {
  const first = await run(request);
  const { resultLoyaltyViolations, contextLoyaltyCorrection, CONTEXT_LOYALTY_ERROR } =
    await import('./context-loyalty');
  const violations = resultLoyaltyViolations(request, first);
  if (violations.length === 0) return { result: first, attempts: 1, corrected: false };
  console.warn(
    '[generate] Kontexttreue-Verstoss:',
    violations.join('|'),
    'fuer',
    request.contentType,
    '— ein korrigierender Versuch.',
  );
  // Korrektur-Hinweis zweisprachig (der Server kennt die UI-Sprache nicht).
  const retryRequest: ContentRequest = {
    ...request,
    correctionNote: [request.correctionNote, contextLoyaltyCorrection('de'), contextLoyaltyCorrection('en')]
      .filter(Boolean)
      .join('\n\n'),
  };
  const retry = await run(retryRequest);
  const retryViolations = resultLoyaltyViolations(request, retry);
  if (retryViolations.length === 0) return { result: retry, attempts: 2, corrected: true };
  console.error(
    '[generate] Kontexttreue-Verstoss auch nach Korrektur:',
    retryViolations.join('|'),
    'fuer',
    request.contentType,
    '— Ausgabe wird abgelehnt.',
  );
  throw new Error(CONTEXT_LOYALTY_ERROR);
}

async function generateWithContextLoyalty(
  request: ContentRequest,
  config?: AIConfig,
): Promise<ContentResult> {
  const run = await runWithContextLoyalty(request, (req) => runProvider(req, config));
  return finish(request, run.result);
}

export async function generateContent(
  request: ContentRequest,
  config?: AIConfig,
): Promise<ContentResult> {
  return generateWithContextLoyalty(request, config);
}

/**
 * F1 Qualitäts-Score: runs automatically right after generation, server-side,
 * in the same flow that returns ContentResult. Scoring NEVER blocks content:
 * on any failure the content is returned with `score: null` (the UI shows a
 * subtle "Bewertung nicht verfügbar" state instead of an error).
 */
async function attachScore(
  request: ContentRequest,
  result: ContentResult,
): Promise<ContentResult> {
  try {
    const { scoreContent } = await import('./scoring');
    const score = await scoreContent(request, result);
    console.log(
      '[generate] Score for',
      request.contentType,
      '→',
      score.total,
      score.summary.slice(0, 80),
    );
    return { ...result, score };
  } catch (err) {
    console.error('[generate] Scoring failed, returning unscored content:', err);
    return { ...result, score: null };
  }
}
/**
 * Problem 3: Post-Generation-Guard gegen unbelegte Metrik-Claims.
 * Scanner + Neutralisierer, laeuft auf dem Import-Pfad von generateContent,
 * deckt damit Einzel-Kanaele UND alle Paket-Kanaele ab. Wirft nie — bei Fehler
 * bleibt der Originaltext erhalten. `userContext` = Nutzer-/Produktfakten, so
 * dass Echtdaten des Nutzers nie entfernt werden.
 */
async function applyMetricGuard(
  request: ContentRequest,
  result: ContentResult,
): Promise<ContentResult> {
  try {
    const { sanitizeUnbackedMetrics } = await import('./metric-guard');
    const userContext = [request.productIdea, request.additionalContext ?? '']
      .filter(Boolean)
      .join('\n');
    const cleanedBody = await sanitizeUnbackedMetrics(result.body, userContext);
    if (cleanedBody.text !== result.body) {
      console.log('[generate] Metric-Guard neutralisierte unbelegte Kennzahlen fuer', request.contentType);
      return { ...result, body: cleanedBody.text };
    }
    return result;
  } catch (err) {
    console.error('[generate] Metric-Guard skipped:', err);
    return result;
  }
}

import type { AIConfig, ContentRequest, ContentResult } from './types';
import { getConfiguredProviders } from './providers/index';

export async function generateContent(
  request: ContentRequest,
  config?: AIConfig,
): Promise<ContentResult> {
  console.log('[generate] Request:', JSON.stringify(request));

  if (config) {
    const { getProvider } = await import('./providers/index');
    const provider = getProvider(config.provider);
    console.log('[generate] Using explicit provider:', config.provider, 'configured:', provider.isConfigured());
    if (provider.isConfigured()) {
      const result = await provider.generate(request, config);
      return attachScore(request, result);
    }
  }

  const configured = getConfiguredProviders();
  console.log('[generate] Configured providers:', configured.length);

  if (configured.length > 0) {
    const providerConfig: AIConfig = config ?? { provider: 'openai' };
    console.log('[generate] Using provider:', configured[0].name);
    const result = await configured[0].generate(request, providerConfig);
    return attachScore(request, result);
  }

  // Never silently fall back to placeholder/demo content. Without a configured
  // AI provider the user must see a clear error, not fake output.
  throw new Error(
    'Kein KI-Anbieter konfiguriert. Bitte OPENAI_API_KEY in den Umgebungsvariablen setzen, um Inhalte zu generieren.',
  );
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

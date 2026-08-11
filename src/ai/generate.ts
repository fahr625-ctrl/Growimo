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

  // Never silently fall back to placeholder/demo content. Without a configured
  // AI provider the user must see a clear error, not fake output.
  throw new Error(
    'Kein KI-Anbieter konfiguriert. Bitte OPENAI_API_KEY in den Umgebungsvariablen setzen, um Inhalte zu generieren.',
  );
}

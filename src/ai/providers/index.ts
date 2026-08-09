import type { AIProvider } from '../types';
import { createOpenAIProvider } from './openai';

const registry = new Map<string, () => AIProvider>();

// Register OpenAI provider
registry.set('openai', createOpenAIProvider);

// Placeholder for future providers:
// registry.set('anthropic', createAnthropicProvider);
// registry.set('gemini', createGeminiProvider);

export function getProvider(name: string): AIProvider {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown provider "${name}". Available providers: ${[...registry.keys()].join(', ')}`,
    );
  }
  return factory();
}

export function getConfiguredProviders(): AIProvider[] {
  const allProviders = [...registry.values()].map((factory) => factory());
  return allProviders.filter((p) => p.isConfigured());
}

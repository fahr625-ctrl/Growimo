import { createOpenAIProvider } from './src/ai/providers/openai.ts';
const provider = createOpenAIProvider();
console.log('Provider configured:', provider.isConfigured());
if (!provider.isConfigured()) { console.log('NO KEY'); process.exit(1); }
const idea = 'Handgefertigte Keramikvase aus Steinzeug, grau-blaue Glasur, 20 cm hoch, Unikat für moderne Wohnzimmer';
const pinterest = await provider.generate({
  contentType: 'pinterest_pin',
  productIdea: idea,
  tone: 'freundlich',
  additionalContext: '',
}, { provider: 'openai' });
console.log('=== PINTEREST ===');
console.log('TITLE:', pinterest.title);
console.log('BODY (first 400):', pinterest.body.slice(0, 400));
console.log('generatedBy:', pinterest.metadata?.generatedBy ?? 'openai');
const etsy = await provider.generate({
  contentType: 'etsy_listing',
  productIdea: idea,
  tone: 'hochwertig',
  additionalContext: '',
}, { provider: 'openai' });
console.log('=== ETSY ===');
console.log('TITLE:', etsy.title);
console.log('BODY (first 500):', etsy.body.slice(0, 500));
console.log('generatedBy:', etsy.metadata?.generatedBy ?? 'openai');

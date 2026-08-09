import { createFileRoute, useSearch } from '@tanstack/react-router';
import { QuickGeneratorPage, type QuickGeneratorProps } from '~/components/QuickGenerator';

export const Route = createFileRoute('/app/generate/etsy')({
  validateSearch: (search: Record<string, unknown>) => ({
    idea: typeof search.idea === 'string' ? search.idea : undefined,
  }),
  component: EtsyPage,
});

const PROPS: QuickGeneratorProps = {
  contentType: 'etsy_listing',
  titleKey: 'gen_etsy_title',
  subtitleKey: 'gen_etsy_subtitle',
  ctaKey: 'gen_generate_etsy',
  icon: '🛍️',
  accent: 'from-orange-100 to-amber-100',
  loadingKeys: ['loading_analyze', 'loading_research', 'loading_etsy', 'loading_finalize'],
};

function EtsyPage() {
  const { idea } = useSearch({ from: '/app/generate/etsy' });
  return <QuickGeneratorPage props={{ ...PROPS, initialIdea: idea }} />;
}

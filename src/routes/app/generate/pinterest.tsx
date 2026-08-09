import { createFileRoute, useSearch } from '@tanstack/react-router';
import { QuickGeneratorPage, type QuickGeneratorProps } from '~/components/QuickGenerator';

export const Route = createFileRoute('/app/generate/pinterest')({
  validateSearch: (search: Record<string, unknown>) => ({
    idea: typeof search.idea === 'string' ? search.idea : undefined,
  }),
  component: PinterestPage,
});

const PROPS: QuickGeneratorProps = {
  contentType: 'pinterest_pin',
  titleKey: 'gen_pinterest_title',
  subtitleKey: 'gen_pinterest_subtitle',
  ctaKey: 'gen_generate_pinterest',
  icon: '📌',
  accent: 'from-red-100 to-orange-100',
  loadingKeys: ['loading_analyze', 'loading_research', 'loading_pinterest', 'loading_finalize'],
};

function PinterestPage() {
  const { idea } = useSearch({ from: '/app/generate/pinterest' });
  return <QuickGeneratorPage props={{ ...PROPS, initialIdea: idea }} />;
}

import { createFileRoute, useSearch } from '@tanstack/react-router';
import { QuickGeneratorPage, type QuickGeneratorProps } from '~/components/QuickGenerator';

export const Route = createFileRoute('/app/generate/blog')({
  validateSearch: (search: Record<string, unknown>) => ({
    idea: typeof search.idea === 'string' ? search.idea : undefined,
  }),
  component: BlogPage,
});

const PROPS: QuickGeneratorProps = {
  contentType: 'seo_blog',
  titleKey: 'gen_blog_title',
  subtitleKey: 'gen_blog_subtitle',
  ctaKey: 'gen_generate_blog',
  icon: '📝',
  accent: 'from-blue-100 to-purple-100',
  loadingKeys: ['loading_analyze', 'loading_research', 'loading_blog', 'loading_finalize'],
};

function BlogPage() {
  const { idea } = useSearch({ from: '/app/generate/blog' });
  return <QuickGeneratorPage props={{ ...PROPS, initialIdea: idea }} />;
}

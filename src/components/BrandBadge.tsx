import { Link } from '@tanstack/react-router';
import { hasBrandProfile } from '~/store/brand';
import { useTranslation } from '~/i18n';

/**
 * Small indicator pill badge shown when a brand profile is configured.
 * Positioned near the product idea input field on the new-project page.
 */
export default function BrandBadge() {
  const { t } = useTranslation();

  // SSR guard — only check on client
  if (typeof window === 'undefined') return null;
  if (!hasBrandProfile()) return null;

  return (
    <Link
      to="/app/brand"
      className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 hover:text-blue-800"
      title={t.brand_active}
    >
      <span>🏷️</span>
      <span>{t.brand_active}</span>
    </Link>
  );
}

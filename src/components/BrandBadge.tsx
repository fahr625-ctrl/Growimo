import { Link } from '@tanstack/react-router';
import { getBrandProfile } from '~/store/brand';
import { useTranslation } from '~/i18n';

/**
 * Small indicator pill badge shown when a brand profile is configured.
 * Positioned near the product idea input field on the new-project page.
 * Phase 1: zeigt zusätzlich den EIN/AUS-Zustand an („Markenprofil aus", wenn
 * das Profil per Schalter deaktiviert ist).
 */
export default function BrandBadge() {
  const { t } = useTranslation();

  // SSR guard — only check on client
  if (typeof window === 'undefined') return null;
  const profile = getBrandProfile();
  if (!profile) return null;

  const enabled = profile.enabled !== false;

  return (
    <Link
      to="/app/brand"
      data-testid="brand-badge"
      data-enabled={enabled ? 'true' : 'false'}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        enabled
          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-700'
      }`}
      title={enabled ? t.brand_active : t.brand_badge_off}
    >
      <span>🏷️</span>
      <span>{enabled ? t.brand_active : t.brand_badge_off}</span>
    </Link>
  );
}

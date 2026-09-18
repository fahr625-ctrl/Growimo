import { useEffect, useState } from 'react';
import { getBrandProfile, setBrandProfileEnabled, type BrandProfile } from '~/store/brand';
import { useTranslation } from '~/i18n';
import { trackEvent } from '~/store/analytics';

/**
 * Phase 1 (Stabilisierung, C4) — sichtbarer EIN/AUS-Schalter des Markenprofils.
 *
 * EIN  = wie bisher (Markenprofil darf Kontext liefern — die Nutzereingabe hat
 *        trotzdem Vorrang, siehe Vorrang-Regel im Markenblock).
 * AUS  = das Markenprofil wird NIRGENDS verwendet (kein Kontext, keine
 *        Vorbefüllung, keine Empfehlung); gespeichert bleibt es vollständig.
 *
 * Rendert nichts, solange gar kein Markenprofil existiert (dann gibt es nichts
 * zu schalten). Der Zustand ist über `data-enabled` testbar.
 */
interface BrandProfileToggleProps {
  /** Wird bei jeder Umschaltung mit dem neuen Zustand aufgerufen. */
  onChange?: (enabled: boolean) => void;
  /** Kompaktere Darstellung (eine Zeile). */
  compact?: boolean;
}

export default function BrandProfileToggle({ onChange, compact = false }: BrandProfileToggleProps) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<BrandProfile | null>(null);

  // SSR-Guard: localStorage gibt es nur im Browser.
  useEffect(() => {
    setProfile(getBrandProfile());
  }, []);

  if (!profile) return null;

  const enabled = profile.enabled !== false;

  const toggle = () => {
    const next = !enabled;
    setBrandProfileEnabled(next);
    setProfile((p) => (p ? { ...p, enabled: next } : p));
    try {
      trackEvent(next ? 'brand_profile_enabled' : 'brand_profile_disabled');
    } catch {
      /* analytics must never surface errors */
    }
    onChange?.(next);
  };

  return (
    <div
      data-testid="brand-profile-toggle"
      data-enabled={enabled ? 'true' : 'false'}
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
        enabled ? 'border-blue-100 bg-blue-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t.brand_toggle_label}
        data-testid="brand-profile-switch"
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
          enabled ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      <div className="min-w-0">
        <p
          className={`text-sm font-semibold ${enabled ? 'text-blue-900' : 'text-gray-700'}`}
          data-testid="brand-profile-toggle-state"
        >
          {t.brand_toggle_label}: {enabled ? t.brand_toggle_on : t.brand_toggle_off}
        </p>
        {!compact && (
          <p className={`mt-0.5 text-xs ${enabled ? 'text-blue-700' : 'text-gray-500'}`}>
            {enabled ? t.brand_toggle_on_hint : t.brand_toggle_off_hint}
          </p>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { findOption, type BriefQuestionKey } from '~/ai/strategy-brief/questions';
import type { MarketingKernel } from '~/ai/package/kernel';
import { useTranslation } from '~/i18n';

/**
 * F4 Punkt 1 — „Paket-Überblick": kompakte, übersichtliche Zusammenfassung des
 * Wesentlichen direkt unter dem Ergebnis-Header, statt der kompletten
 * Produkt-Eingabe als langes H2. Zeilen: Produkt(idee), Zielgruppe, USP,
 * Preispositionierung, Ziel/Anlass, Ton und Zielbotschaft. Die Felder kommen
 * bevorzugt aus dem optionalen Strategie-Brief (kurze Labels via findOption),
 * sonst aus dem Strategie-Kern (kernel). Die vollständige Produktidee bleibt
 * per Aufklappen zugänglich.
 */
function briefLiteral(
  brief: Record<string, string> | undefined,
  key: string,
  locale: 'de' | 'en',
): string | null {
  const value = brief?.[key];
  if (!value || !value.trim()) return null;
  const option = findOption(key as BriefQuestionKey, value.trim());
  return option ? option.label[locale] : value.trim();
}

export function PackageOverview({
  productIdea,
  brief,
  kernel,
}: {
  productIdea: string;
  brief?: Record<string, string>;
  kernel: MarketingKernel;
}) {
  const { t, locale } = useTranslation();
  const tLookup = t as unknown as Record<string, string>;
  const lang = locale === 'en' ? 'en' : 'de';
  const [showFull, setShowFull] = useState(false);

  const product = productIdea.trim();
  const productShort = useMemo(() => {
    const oneLine = product.split('\n')[0].trim();
    return oneLine.length > 90 ? oneLine.slice(0, 90) + '…' : oneLine;
  }, [product]);

  // Feld: [labelKey, wert?] — null/leer wird übersprungen.
  const rows = useMemo(() => {
    const audience = briefLiteral(brief, 'audience', lang) ?? kernel.audienceNote;
    const usp = briefLiteral(brief, 'usp', lang);
    const price = briefLiteral(brief, 'price', lang);
    const season = briefLiteral(brief, 'season', lang);
    const voice = briefLiteral(brief, 'voice', lang) ?? kernel.voice;
    return [
      { label: 'package_overview_product', value: product, always: true },
      { label: 'package_overview_audience', value: audience, always: true },
      { label: 'package_overview_usp', value: usp },
      { label: 'package_overview_price', value: price },
      { label: 'package_overview_season', value: season },
      { label: 'package_overview_voice', value: voice },
      { label: 'package_overview_hook', value: kernel.mainHook, always: true },
    ].filter((r) => r.always || (r.value && r.value.trim().length > 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, kernel, lang, product]);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-fuchsia-600">
          {tLookup.package_overview_title}
        </span>
        <p className="mt-0.5 text-xs text-gray-500">{tLookup.package_overview_subtitle}</p>
      </div>
      <div className="grid gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {tLookup[row.label]}
            </p>
            {row.label === 'package_overview_product' ? (
              <div>
                <p className="mt-1 text-sm font-medium leading-relaxed text-gray-800">
                  {showFull ? product : productShort}
                </p>
                {product.length > productShort.length && (
                  <button
                    type="button"
                    onClick={() => setShowFull((s) => !s)}
                    className="mt-1 text-[11px] font-semibold text-fuchsia-600 underline hover:text-fuchsia-800"
                  >
                    {showFull
                      ? tLookup.package_overview_hide_original
                      : tLookup.package_overview_show_original}
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm font-medium leading-relaxed text-gray-800">{row.value}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

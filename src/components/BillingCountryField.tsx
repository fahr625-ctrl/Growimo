import { useTranslation } from '~/i18n';

/**
 * DE-Launch-Gate (Owner-Auftrag 2026-10-26): Auswahl „Rechnungsland" vor dem
 * Checkout. Deutschland ist vorausgewählt; jede andere Wahl blockiert den
 * Kauf-Button und zeigt eine klare Meldung — es wird dann GAR KEINE
 * Checkout-Session erzeugt.
 *
 * Die Auswahl hier ist nur die Vorprüfung (bessere Fehlermeldung). Verbindlich
 * sind zwei serverseitige Sperren: `createCheckoutSession` (fail-closed, VOR dem
 * ersten Stripe-Call) und der Webhook (cancel + volle Erstattung, falls das
 * echte Rechnungsland in Stripe doch nicht DE ist).
 */
export const BILLING_COUNTRY_DE = 'DE';
/** Sentinel für „nicht Deutschland" — bewusst KEIN echtes Länderkürzel. */
export const BILLING_COUNTRY_OTHER = 'OTHER';

export function isBlockedBillingCountry(value: string): boolean {
  return value !== BILLING_COUNTRY_DE;
}

export function BillingCountryField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const blocked = isBlockedBillingCountry(value);

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-left">
      <label
        htmlFor="billing-country"
        className="block text-xs font-medium text-gray-800"
      >
        {t.pricing_billing_country_label}
      </label>
      <select
        id="billing-country"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
      >
        <option value={BILLING_COUNTRY_DE}>{t.pricing_billing_country_de}</option>
        <option value={BILLING_COUNTRY_OTHER}>
          {t.pricing_billing_country_other}
        </option>
      </select>
      {blocked ? (
        <p
          role="alert"
          className="mt-2 text-[11px] font-medium leading-relaxed text-red-700"
        >
          {t.pricing_billing_country_blocked}
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          {t.pricing_billing_country_hint}
        </p>
      )}
    </div>
  );
}

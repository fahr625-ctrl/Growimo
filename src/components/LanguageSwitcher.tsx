import { useTranslation } from '~/i18n';

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-0.5">
      <button
        type="button"
        onClick={() => setLocale('de')}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
          locale === 'de'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {t.lang_de}
      </button>
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
          locale === 'en'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {t.lang_en}
      </button>
    </div>
  );
}

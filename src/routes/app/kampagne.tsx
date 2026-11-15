import { seoHead } from '~/lib/seo';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import {
  CAMPAIGN_LIMITS,
  optionIncludesEtsy,
  optionNeedsPhoto,
  validateCampaignDraft,
  type CampaignDraft,
  type CampaignOption,
} from '~/lib/kampagne/campaign';
import {
  getCampaignServer,
  listCampaignsServer,
  saveCampaignServer,
  type CampaignRecord,
  type CampaignSummary,
} from '~/lib/kampagne/campaign-server';

export const Route = createFileRoute('/app/kampagne')({
  head: () => seoHead({ titleKey: 'meta_app_kampagne_title' }),
  component: KampagnePage,
});

function KampagnePage() {
  return (
    <ProtectedRoute>
      <KampagneContent />
    </ProtectedRoute>
  );
}

/** Leerer Entwurf (Standard: Nur Pinterest — der einfachste Weg ohne Etsy). */
function emptyDraft(): CampaignDraft {
  return {
    id: null,
    name: '',
    option: 'pinterest',
    product: '',
    audience: '',
    message: '',
    targetUrl: '',
    photoDataUrl: null,
    brandApplied: false,
  };
}

function KampagneContent() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CampaignDraft>(emptyDraft);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [photoBytes, setPhotoBytes] = useState<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const needsPhoto = optionNeedsPhoto(draft.option);
  const includesEtsy = optionIncludesEtsy(draft.option);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await listCampaignsServer();
      setCampaigns(list);
    } catch {
      setCampaigns([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const setField = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  };

  const onPhotoSelected = async (file: File | null) => {
    if (!file) return;
    setErrors([]);
    setNotice(null);
    if (file.size > CAMPAIGN_LIMITS.photoMaxBytes) {
      setErrors(['photo_too_large']);
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(file);
    }).catch(() => '');
    if (!dataUrl) {
      setErrors(['photo_invalid']);
      return;
    }
    setPhotoBytes(file.size);
    setField('photoDataUrl', dataUrl);
  };

  const onSave = async () => {
    const check = validateCampaignDraft(draft);
    if (!check.ok) {
      setErrors(check.errors);
      setNotice(null);
      return;
    }
    setSaving(true);
    setErrors([]);
    setNotice(null);
    try {
      const saved: CampaignRecord = await saveCampaignServer({ data: draft });
      // Der Server gibt den LESEND geprüften Stand zurück — der Client zeigt
      // genau diesen, nicht den lokalen Entwurf.
      setDraft({
        id: saved.id,
        name: saved.name,
        option: saved.option,
        product: saved.product,
        audience: saved.audience,
        message: saved.message,
        targetUrl: saved.targetUrl,
        photoDataUrl: saved.photoDataUrl,
        brandApplied: saved.brandApplied,
      });
      setNotice(t.kampagne_save_ok);
      await refreshList();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      const list = (err as { errors?: string[] } | null)?.errors;
      setErrors(list && list.length > 0 ? list : [code === 'photo_unprocessable' ? 'photo_unprocessable' : 'generic']);
    } finally {
      setSaving(false);
    }
  };

  const onOpen = async (id: string) => {
    setOpeningId(id);
    setErrors([]);
    setNotice(null);
    try {
      const record = await getCampaignServer({ data: { id } });
      if (!record) {
        setErrors(['generic']);
        return;
      }
      setDraft({
        id: record.id,
        name: record.name,
        option: record.option,
        product: record.product,
        audience: record.audience,
        message: record.message,
        targetUrl: record.targetUrl,
        photoDataUrl: record.photoDataUrl,
        brandApplied: record.brandApplied,
      });
      setPhotoBytes(0);
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setErrors(['generic']);
    } finally {
      setOpeningId(null);
    }
  };

  const onNew = () => {
    setDraft(emptyDraft());
    setErrors([]);
    setNotice(null);
    setPhotoBytes(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  const optionCard = (option: CampaignOption, label: string, hint: string) => {
    const active = draft.option === option;
    return (
      <button
        type="button"
        onClick={() => setField('option', option)}
        aria-pressed={active}
        className={`rounded-xl border p-4 text-left transition ${
          active
            ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-500'
            : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
      >
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="mt-1 block text-xs text-gray-600">{hint}</span>
      </button>
    );
  };

  const errorText = (code: string): string => {
    const map: Record<string, string> = {
      product_required: t.kampagne_err_product_required,
      product_too_long: t.kampagne_err_product_too_long,
      photo_required: t.kampagne_err_photo_required,
      photo_invalid: t.kampagne_err_photo_invalid,
      photo_too_large: t.kampagne_err_photo_too_large,
      photo_unprocessable: t.kampagne_err_photo_unprocessable,
      url_invalid: t.kampagne_err_url_invalid,
      url_too_long: t.kampagne_err_url_too_long,
      name_too_long: t.kampagne_err_name_too_long,
      audience_too_long: t.kampagne_err_audience_too_long,
      message_too_long: t.kampagne_err_message_too_long,
      option: t.kampagne_err_option,
      payload: t.kampagne_err_generic,
      generic: t.kampagne_err_generic,
    };
    return map[code] ?? t.kampagne_err_generic;
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.kampagne_title}</h1>
        <p className="mt-2 text-sm text-gray-600">{t.kampagne_subtitle}</p>
      </header>

      {errors.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <ul className="list-inside list-disc space-y-1">
            {errors.map((code) => (
              <li key={code}>{errorText(code)}</li>
            ))}
          </ul>
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      {/* Schritt 1 — Option */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">{t.kampagne_option_legend}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {optionCard('pinterest', t.kampagne_option_pinterest, t.kampagne_option_pinterest_hint)}
          {optionCard('etsy', t.kampagne_option_etsy, t.kampagne_option_etsy_hint)}
          {optionCard('both', t.kampagne_option_both, t.kampagne_option_both_hint)}
        </div>
      </section>

      {/* Schritt 2 — gemeinsame Produktangaben */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">{t.kampagne_shared_legend}</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-700">{t.kampagne_product}</span>
          <textarea
            value={draft.product}
            onChange={(e) => setField('product', e.target.value)}
            placeholder={t.kampagne_product_ph}
            maxLength={CAMPAIGN_LIMITS.productMax}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-700">{t.kampagne_audience}</span>
          <input
            value={draft.audience}
            onChange={(e) => setField('audience', e.target.value)}
            placeholder={t.kampagne_audience_ph}
            maxLength={CAMPAIGN_LIMITS.audienceMax}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-700">{t.kampagne_message}</span>
          <input
            value={draft.message}
            onChange={(e) => setField('message', e.target.value)}
            placeholder={t.kampagne_message_ph}
            maxLength={CAMPAIGN_LIMITS.messageMax}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">{t.kampagne_target_url}</span>
          <input
            value={draft.targetUrl}
            onChange={(e) => setField('targetUrl', e.target.value)}
            placeholder={t.kampagne_target_url_ph}
            maxLength={CAMPAIGN_LIMITS.targetUrlMax}
            inputMode="url"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="mt-1 block text-xs text-gray-500">{t.kampagne_target_url_hint}</span>
        </label>
      </section>

      {/* Schritt 3 — Foto (nur Pinterest/Beides) */}
      {needsPhoto ? (
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">{t.kampagne_photo}</h2>
          <p className="mb-3 text-xs text-gray-600">{t.kampagne_photo_hint}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void onPhotoSelected(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
          />
          {draft.photoDataUrl ? (
            <div className="mt-3">
              <img
                src={draft.photoDataUrl}
                alt={t.kampagne_photo_preview_alt}
                className="max-h-56 w-auto rounded-lg border border-gray-200"
              />
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                {photoBytes > 0 && <span>{Math.round(photoBytes / 1024)} KB</span>}
                <button
                  type="button"
                  onClick={() => {
                    setField('photoDataUrl', null);
                    setPhotoBytes(0);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  className="text-blue-600 underline"
                >
                  {t.kampagne_photo_remove}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          {t.kampagne_photo_none_etsy}
        </p>
      )}

      {includesEtsy && (
        <p className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          {t.kampagne_etsy_pending_hint}
        </p>
      )}

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? t.kampagne_saving : t.kampagne_save}
        </button>
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t.kampagne_new}
        </button>
        <span className="text-xs text-gray-500">{t.kampagne_next_hint}</span>
      </div>

      {/* Gespeicherte Kampagnen — wieder öffnen */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">{t.kampagne_list_title}</h2>
        {loadingList ? (
          <p className="text-sm text-gray-500">{t.kampagne_loading}</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-gray-500">{t.kampagne_list_empty}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{c.name || c.product}</p>
                  <p className="text-xs text-gray-500">
                    {c.option === 'pinterest'
                      ? t.kampagne_option_pinterest
                      : c.option === 'etsy'
                        ? t.kampagne_option_etsy
                        : t.kampagne_option_both}
                    {c.hasPhoto ? ` · ${t.kampagne_list_has_photo}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onOpen(c.id)}
                  disabled={openingId === c.id}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {openingId === c.id ? t.kampagne_opening : t.kampagne_open}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import { seoHead } from '~/lib/seo';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  PIN_DESCRIPTION_MAX,
  PIN_HEADLINE_MAX,
  PIN_SUBLINE_MAX,
  PIN_TITLE_MAX,
  buildPinDrafts,
  type PinDraft,
} from '~/lib/kampagne/pin-drafts';
import { renderPinsServer, type PinBrandInput } from '~/lib/kampagne/pin-server';
import {
  ETSY_DESCRIPTION_MAX,
  ETSY_TITLE_MAX,
  buildEtsyDraft,
  etsyTagCandidates,
  etsyTagsComplete,
  formatTagList,
  parseTagInput,
  type EtsyDraft,
} from '~/lib/kampagne/etsy-draft';
import { ETSY_TAG_COUNT, ETSY_TAG_MAX_CHARS, sanitizeEtsyTags } from '~/lib/etsy-tags';
import { downscalePhoto } from '~/lib/kampagne/pin-client';
import {
  buildZip,
  dataUrlToBytes,
  downloadBytes,
  pinFileName,
  zipFileName,
} from '~/lib/kampagne/pin-export';
import type { PinLayoutId } from '~/lib/kampagne/pin-render';
import { getBrandProfile } from '~/store/brand';

/** Schlüssel des Entwurfs im sessionStorage (Foto + Angaben überleben einen Remount). */
const DRAFT_STORE_KEY = 'growimo.kampagne.entwurf.v1';

/**
 * Eingabefelder und Auswahlwerte (Owner-Befund 2026-11-15, Android/390 px):
 * Auf dem Handy waren Feldinhalte und Auswahltexte kaum zu lesen. Deshalb:
 *   • `bg-white` + `text-gray-900` ausdrücklich — ohne eigene Fläche erbte das
 *     Feld im dunklen Farbschema die dunkle Seite und blieb mit schwarzer
 *     Systemschrift auf dunklem Grund stehen.
 *   • `[color-scheme:light]` — Auswahlliste und Farbwähler des Systems bleiben
 *     hell, statt dunkel auf dunkel zu rendern.
 *   • `text-base` (16 px) auf dem Handy: kleinere Schrift zoomt der Browser beim
 *     Fokussieren hinein und schneidet den Wert ab; ab `sm` wieder kompakt.
 *   • `min-h-11` (44 px) als gut treffbare Höhe.
 */
const FIELD_CLASS =
  'w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 ' +
  'placeholder:text-gray-500 [color-scheme:light] focus:border-blue-500 focus:outline-none ' +
  'focus:ring-1 focus:ring-blue-500 sm:text-sm';

/** Feldbeschriftung: kräftiger Kontrast (gray-700 auf Weiß = 10,3 : 1). */
const FIELD_LABEL_CLASS = 'mb-1 block text-xs font-semibold text-gray-700';

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
    etsy: null,
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

  // ── Pin-Entwürfe ────────────────────────────────────────────────────────────
  const [pins, setPins] = useState<PinDraft[]>([]);
  const pinsRef = useRef<PinDraft[]>([]);
  const [renders, setRenders] = useState<Record<string, string>>({});
  const [renderingIds, setRenderingIds] = useState<string[]>([]);
  const [pinError, setPinError] = useState<string | null>(null);
  const [brandName, setBrandName] = useState('');
  const [brandColors, setBrandColors] = useState('');
  const [brandAvailable, setBrandAvailable] = useState(false);
  const renderPhotoRef = useRef<{ src: string; out: string } | null>(null);
  const renderTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** Das Foto, das „Entwürfe neu erzeugen" NIE verliert — nur „Foto entfernen" leert es. */
  const photoRef = useRef<string | null>(null);

  const needsPhoto = optionNeedsPhoto(draft.option);
  const includesEtsy = optionIncludesEtsy(draft.option);

  // ── Etsy-Entwurf ────────────────────────────────────────────────────────────
  // Kein KI-Aufruf: Titel, Beschreibung und die 13 Tags entstehen aus den
  // Nutzerangaben (etsy-draft.ts). Gespeichert wird der geprüfte Stand.
  const [etsy, setEtsy] = useState<EtsyDraft | null>(null);
  const etsyRef = useRef<EtsyDraft | null>(null);
  const [tagText, setTagText] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const applyEtsy = useCallback((next: EtsyDraft | null) => {
    etsyRef.current = next;
    setEtsy(next);
    setTagText(next ? next.tags.join('\n') : '');
  }, []);

  // Markenprofil: nur Farben + Markenname werden übernommen — was das Profil
  // nicht hergibt (Schrift, Logo), wird nicht erfunden.
  useEffect(() => {
    const profile = getBrandProfile();
    if (!profile) return;
    setBrandName(profile.brandName ?? '');
    setBrandColors(profile.brandColors ?? '');
    setBrandAvailable(!!(profile.brandName || profile.brandColors));
  }, []);

  const brandInput = useMemo<PinBrandInput>(
    () => ({
      applied: draft.brandApplied === true,
      colors: brandColors,
      name: brandName,
    }),
    [draft.brandApplied, brandColors, brandName],
  );

  const applyPins = useCallback((next: PinDraft[]) => {
    pinsRef.current = next;
    setPins(next);
  }, []);

  /**
   * Den zuletzt bearbeiteten Entwurf zurückholen. Grund (Befund 2026-11-15):
   * nach einem Remount standen Foto und Karten plötzlich leer da. Was hier
   * liegt, wird wiederhergestellt — ein unlesbarer Eintrag wird nur
   * übersprungen, nie gelöscht.
   */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<CampaignDraft> | null;
      if (!saved || typeof saved !== 'object') return;
      setDraft((prev) => ({ ...prev, ...saved, id: saved.id ?? null }));
      if (typeof saved.photoDataUrl === 'string' && saved.photoDataUrl) {
        photoRef.current = saved.photoDataUrl;
      }
      if (Array.isArray(saved.pins) && saved.pins.length > 0) applyPins(saved.pins as PinDraft[]);
    } catch {
      // unlesbarer Eintrag: überspringen
    }
  }, [applyPins]);

  /** Jede Änderung mitschreiben — das Foto in der Render-Größe, nicht als 8-MB-Original. */
  useEffect(() => {
    try {
      sessionStorage.setItem(
        DRAFT_STORE_KEY,
        JSON.stringify({
          ...draft,
          photoDataUrl: renderPhotoRef.current?.out ?? draft.photoDataUrl ?? null,
          pins,
          etsy,
        }),
      );
    } catch {
      // Speicher voll: der Entwurf bleibt im Zustand, nichts wird gelöscht
    }
  }, [draft, pins, etsy]);

  /** Foto für das Rendern (einmal verkleinert, dann wiederverwendet). */
  const ensureRenderPhoto = useCallback(async (src: string): Promise<string> => {
    if (renderPhotoRef.current?.src === src) return renderPhotoRef.current.out;
    const out = await downscalePhoto(src);
    renderPhotoRef.current = { src, out };
    return out;
  }, []);

  const renderOne = useCallback(
    async (pin: PinDraft, photoUrl: string, brand: PinBrandInput) => {
      setRenderingIds((prev) => (prev.includes(pin.id) ? prev : [...prev, pin.id]));
      try {
        // Ein einzelner Fehlschlag ist noch kein Ergebnis: genau ein
        // Wiederholversuch, erst danach gilt es als Fehler.
        let res: Awaited<ReturnType<typeof renderPinsServer>> | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 2 && !res; attempt++) {
          try {
            res = await renderPinsServer({
              data: { photoDataUrl: photoUrl, brand, pins: [pin] },
            });
          } catch (err) {
            lastError = err;
          }
        }
        if (!res) throw lastError ?? new Error('render_failed');
        const first = res.pins[0];
        if (first) setRenders((prev) => ({ ...prev, [first.id]: first.dataUrl }));
      } catch {
        setPinError('render');
      } finally {
        setRenderingIds((prev) => prev.filter((id) => id !== pin.id));
      }
    },
    [],
  );

  const onGeneratePins = useCallback(async () => {
    setPinError(null);
    // Das Foto kommt aus dem Ref: „neu erzeugen" arbeitet aus DEMSELBEN Foto,
    // auch wenn das Feld zwischendurch leer wäre — und stellt es wieder her.
    const src = draft.photoDataUrl ?? photoRef.current;
    if (!src) {
      setPinError('photo_required');
      return;
    }
    if (!draft.photoDataUrl) {
      photoRef.current = src;
      setDraft((prev) => (prev.photoDataUrl ? prev : { ...prev, photoDataUrl: src }));
    }
    const next = buildPinDrafts({
      product: draft.product,
      audience: draft.audience,
      message: draft.message,
    });
    applyPins(next);
    setRenders({});
    const brand = brandInput;
    const photoUrl = await ensureRenderPhoto(src);
    for (const pin of next) {
      await renderOne(pin, photoUrl, brand);
    }
  }, [applyPins, brandInput, draft.photoDataUrl, draft.product, draft.audience, draft.message, ensureRenderPhoto, renderOne]);

  /** Ein Feld eines Pins ändern und die Vorschau nach kurzer Pause neu rendern. */
  const updatePin = useCallback(
    <K extends keyof PinDraft>(id: string, key: K, value: PinDraft[K]) => {
      const current = pinsRef.current.find((p) => p.id === id);
      if (!current) return;
      const updated = { ...current, [key]: value } as PinDraft;
      applyPins(pinsRef.current.map((p) => (p.id === id ? updated : p)));

      const src = draft.photoDataUrl;
      if (!src || !updated.headline.trim()) return;
      if (renderTimers.current[id]) clearTimeout(renderTimers.current[id]);
      const brand = brandInput;
      renderTimers.current[id] = setTimeout(() => {
        void ensureRenderPhoto(src).then((photoUrl) => renderOne(updated, photoUrl, brand));
      }, 600);
    },
    [applyPins, brandInput, draft.photoDataUrl, ensureRenderPhoto, renderOne],
  );

  useEffect(
    () => () => {
      for (const t of Object.values(renderTimers.current)) clearTimeout(t);
    },
    [],
  );

  /** Alle vorhandenen Entwürfe neu rendern (z. B. wenn das Markenprofil schaltet). */
  const rerenderAll = useCallback(
    async (brand: PinBrandInput) => {
      const src = draft.photoDataUrl;
      if (!src || pinsRef.current.length === 0) return;
      const photoUrl = await ensureRenderPhoto(src);
      for (const pin of pinsRef.current) {
        await renderOne(pin, photoUrl, brand);
      }
    },
    [draft.photoDataUrl, ensureRenderPhoto, renderOne],
  );

  /** Nach einem Fehlschlag: alle Karten erneut rendern — mit DEMSELBEN Foto. */
  const retryRenders = useCallback(async () => {
    setPinError(null);
    const src = draft.photoDataUrl ?? photoRef.current;
    if (!src) {
      setPinError('photo_required');
      return;
    }
    if (!draft.photoDataUrl) {
      photoRef.current = src;
      setDraft((prev) => (prev.photoDataUrl ? prev : { ...prev, photoDataUrl: src }));
    }
    const photoUrl = await ensureRenderPhoto(src);
    for (const pin of pinsRef.current) {
      await renderOne(pin, photoUrl, brandInput);
    }
  }, [brandInput, draft.photoDataUrl, ensureRenderPhoto, renderOne]);

  const onToggleBrand = (checked: boolean) => {
    setField('brandApplied', checked);
    void rerenderAll({ applied: checked, colors: brandColors, name: brandName });
  };

  // ── Export (PNG je Pin, ZIP für alle) ───────────────────────────────────────
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Rendert ALLE Pins aus dem JETZT bearbeiteten Stand und gibt die frischen
   * Data-URLs zurück. Der Export benutzt genau diese Bytes: ein noch laufendes
   * Nachrendern (600 ms nach dem Tippen) darf keinen alten Text in die Datei
   * bringen. Kein KI-Aufruf, keine Einheit — nur Rechnen.
   */
  const renderLatestPins = useCallback(async (): Promise<{
    list: PinDraft[];
    urls: Record<string, string>;
  }> => {
    for (const timer of Object.values(renderTimers.current)) clearTimeout(timer);
    renderTimers.current = {};
    const src = draft.photoDataUrl;
    const list = pinsRef.current;
    if (!src) throw new Error('photo_required');
    if (list.length === 0) throw new Error('no_pins');
    const photoUrl = await ensureRenderPhoto(src);
    setRenderingIds(list.map((p) => p.id));
    try {
      const res = await renderPinsServer({
        data: { photoDataUrl: photoUrl, brand: brandInput, pins: list },
      });
      const urls: Record<string, string> = {};
      for (const rendered of res.pins) urls[rendered.id] = rendered.dataUrl;
      setRenders((prev) => ({ ...prev, ...urls }));
      return { list, urls };
    } finally {
      setRenderingIds([]);
    }
  }, [brandInput, draft.photoDataUrl, ensureRenderPhoto]);

  const onExportPin = useCallback(
    async (pin: PinDraft) => {
      setExporting(pin.id);
      setExportError(null);
      try {
        const { list, urls } = await renderLatestPins();
        const dataUrl = urls[pin.id];
        if (!dataUrl) throw new Error('render_missing');
        const index = list.findIndex((p) => p.id === pin.id);
        downloadBytes(dataUrlToBytes(dataUrl), pinFileName(index, pin.layout), 'image/png');
      } catch {
        setExportError('export');
      } finally {
        setExporting(null);
      }
    },
    [renderLatestPins],
  );

  const onExportZip = useCallback(async () => {
    setExporting('zip');
    setExportError(null);
    try {
      const { list, urls } = await renderLatestPins();
      const entries = list.map((pin, index) => {
        const dataUrl = urls[pin.id];
        if (!dataUrl) throw new Error('render_missing');
        return { name: pinFileName(index, pin.layout), bytes: dataUrlToBytes(dataUrl) };
      });
      downloadBytes(buildZip(entries), zipFileName(draft.name), 'application/zip');
    } catch {
      setExportError('export');
    } finally {
      setExporting(null);
    }
  }, [draft.name, renderLatestPins]);

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
    photoRef.current = dataUrl;
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
      const saved: CampaignRecord = await saveCampaignServer({
        data: { ...draft, pins: pinsRef.current, etsy: etsyRef.current },
      });
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
        pins: saved.pins,
        etsy: saved.etsy,
      });
      applyPins(saved.pins);
      applyEtsy(saved.etsy);
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
        pins: record.pins,
        etsy: record.etsy,
      });
      applyEtsy(record.etsy);
      // Gespeicherte Entwürfe wieder anzeigen — und erneut rendern, damit die
      // Vorschau zeigt, was gespeichert ist (kein KI-Aufruf, keine Einheit).
      applyPins(record.pins);
      setRenders({});
      setPinError(null);
      if (record.pins.length > 0 && record.photoDataUrl) {
        const brand: PinBrandInput = {
          applied: record.brandApplied === true,
          colors: brandColors,
          name: brandName,
        };
        const photoUrl = await ensureRenderPhoto(record.photoDataUrl);
        for (const pin of record.pins) {
          await renderOne(pin, photoUrl, brand);
        }
      }
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
    applyPins([]);
    applyEtsy(null);
    setRenders({});
    setPinError(null);
    setCopied(null);
    setCopyFailed(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── Etsy-Entwurf: bauen, bearbeiten, kopieren ───────────────────────────────

  /** Entwurf aus den gemeinsamen Angaben bauen — kein KI-Aufruf, keine Einheit. */
  const onBuildEtsy = useCallback(() => {
    applyEtsy(
      buildEtsyDraft({
        product: draft.product,
        audience: draft.audience,
        message: draft.message,
      }),
    );
    setCopied(null);
    setCopyFailed(false);
  }, [applyEtsy, draft.product, draft.audience, draft.message]);

  /** Titel/Beschreibung bleiben der Text des Nutzers — nur begrenzt, nie ersetzt. */
  const updateEtsy = useCallback((patch: Partial<EtsyDraft>) => {
    const current = etsyRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    etsyRef.current = next;
    setEtsy(next);
  }, []);

  /**
   * Tags tippen: ein Tag pro Zeile. Was Etsy nicht annimmt (zu lang, doppelt),
   * bereinigt die bestehende Durchsetzung; fehlende Positionen kommen aus den
   * eigenen Angaben des Nutzers — nie aus erfundenen Begriffen.
   */
  const onTagTextChange = useCallback(
    (text: string) => {
      setTagText(text);
      const current = etsyRef.current;
      if (!current) return;
      const source = { product: draft.product, audience: draft.audience, message: draft.message };
      const tags = sanitizeEtsyTags(parseTagInput(text), etsyTagCandidates(source));
      const next = { ...current, tags };
      etsyRef.current = next;
      setEtsy(next);
    },
    [draft.product, draft.audience, draft.message],
  );

  const copyText = useCallback(async (key: string, text: string) => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  }, []);

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

  const layoutLabel = (layout: PinLayoutId): string => {
    const map: Record<PinLayoutId, string> = {
      'bottom-left': t.kampagne_layout_bottom_left,
      'top-band': t.kampagne_layout_top_band,
      'center-card': t.kampagne_layout_center_card,
      'side-stripe': t.kampagne_layout_side_stripe,
      'minimal-frame': t.kampagne_layout_minimal_frame,
    };
    return map[layout] ?? layout;
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
          <span className={FIELD_LABEL_CLASS}>{t.kampagne_product}</span>
          <textarea
            value={draft.product}
            onChange={(e) => setField('product', e.target.value)}
            placeholder={t.kampagne_product_ph}
            maxLength={CAMPAIGN_LIMITS.productMax}
            rows={3}
            className={FIELD_CLASS}
          />
        </label>

        <label className="mb-3 block">
          <span className={FIELD_LABEL_CLASS}>{t.kampagne_audience}</span>
          <input
            value={draft.audience}
            onChange={(e) => setField('audience', e.target.value)}
            placeholder={t.kampagne_audience_ph}
            maxLength={CAMPAIGN_LIMITS.audienceMax}
            className={FIELD_CLASS}
          />
        </label>

        <label className="mb-3 block">
          <span className={FIELD_LABEL_CLASS}>{t.kampagne_message}</span>
          <input
            value={draft.message}
            onChange={(e) => setField('message', e.target.value)}
            placeholder={t.kampagne_message_ph}
            maxLength={CAMPAIGN_LIMITS.messageMax}
            className={FIELD_CLASS}
          />
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>{t.kampagne_target_url}</span>
          <input
            value={draft.targetUrl}
            onChange={(e) => setField('targetUrl', e.target.value)}
            placeholder={t.kampagne_target_url_ph}
            maxLength={CAMPAIGN_LIMITS.targetUrlMax}
            inputMode="url"
            className={FIELD_CLASS}
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
                    photoRef.current = null;
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

      {/* Schritt 4 — fünf Pin-Entwürfe aus diesem Foto */}
      {needsPhoto && draft.photoDataUrl ? (
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">{t.kampagne_pins_title}</h2>
              <p className="mt-1 text-xs text-gray-600">{t.kampagne_pins_hint}</p>
            </div>
            <button
              type="button"
              onClick={() => void onGeneratePins()}
              disabled={renderingIds.length > 0}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {renderingIds.length > 0
                ? t.kampagne_pins_generating
                : pins.length > 0
                  ? t.kampagne_pins_regenerate
                  : t.kampagne_pins_generate}
            </button>
          </div>

          {brandAvailable ? (
            <label className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={draft.brandApplied === true}
                onChange={(e) => onToggleBrand(e.target.checked)}
              />
              <span className="font-medium">{t.kampagne_brand_apply}</span>
              <span className="text-gray-500">
                {[brandName, brandColors].filter(Boolean).join(' · ')}
              </span>
            </label>
          ) : (
            <p className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
              {t.kampagne_brand_none}
            </p>
          )}

          {pinError && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p>{pinError === 'photo_required' ? t.kampagne_err_photo_required : t.kampagne_pin_render_failed}</p>
              {pinError === 'render' && (
                <button
                  type="button"
                  onClick={() => void retryRenders()}
                  disabled={renderingIds.length > 0}
                  className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                >
                  {t.common_retry}
                </button>
              )}
            </div>
          )}

          {pins.length === 0 ? (
            <p className="text-sm text-gray-500">{t.kampagne_pins_empty}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {pins.map((pin) => {
                const isRendering = renderingIds.includes(pin.id);
                const position = pin.offsetY < -0.05 ? 'top' : pin.offsetY > 0.05 ? 'bottom' : 'middle';
                return (
                  <li key={pin.id} className="rounded-xl border border-gray-200 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-900">{layoutLabel(pin.layout)}</span>
                      <span className="text-[11px] text-gray-500">
                        {isRendering ? t.kampagne_pin_rendering : '1000 × 1500 px'}
                      </span>
                    </div>

                    <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                      {renders[pin.id] ? (
                        <img src={renders[pin.id]} alt={pin.headline} className="block w-full" />
                      ) : (
                        <div className="flex h-40 items-center justify-center text-xs text-gray-500">
                          {isRendering ? t.kampagne_pin_rendering : t.kampagne_pin_no_preview}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void onExportPin(pin)}
                      disabled={exporting !== null || isRendering || !renders[pin.id]}
                      className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {exporting === pin.id ? t.kampagne_export_busy : t.kampagne_export_png}
                    </button>

                    <label className="mb-2 block">
                      <span className={FIELD_LABEL_CLASS}>{t.kampagne_pin_overlay}</span>
                      <textarea
                        value={pin.headline}
                        onChange={(e) => updatePin(pin.id, 'headline', e.target.value)}
                        rows={2}
                        maxLength={PIN_HEADLINE_MAX}
                        className={FIELD_CLASS}
                      />
                    </label>

                    <label className="mb-2 block">
                      <span className={FIELD_LABEL_CLASS}>{t.kampagne_pin_subline}</span>
                      <input
                        value={pin.subline}
                        onChange={(e) => updatePin(pin.id, 'subline', e.target.value)}
                        maxLength={PIN_SUBLINE_MAX}
                        className={FIELD_CLASS}
                      />
                    </label>

                    <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className={FIELD_LABEL_CLASS}>{t.kampagne_pin_position}</span>
                        <select
                          value={position}
                          onChange={(e) =>
                            updatePin(
                              pin.id,
                              'offsetY',
                              e.target.value === 'top' ? -0.15 : e.target.value === 'bottom' ? 0.15 : 0,
                            )
                          }
                          className={FIELD_CLASS}
                        >
                          <option value="top">{t.kampagne_pin_position_top}</option>
                          <option value="middle">{t.kampagne_pin_position_middle}</option>
                          <option value="bottom">{t.kampagne_pin_position_bottom}</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className={FIELD_LABEL_CLASS}>{t.kampagne_pin_color}</span>
                        <span className="flex items-center gap-2">
                          <input
                            type="color"
                            value={pin.textColor}
                            onChange={(e) => updatePin(pin.id, 'textColor', e.target.value)}
                            className="h-11 w-16 shrink-0 rounded-lg border border-gray-300 bg-white [color-scheme:light]"
                          />
                          {/* Der Farbwert ist im Feld selbst nicht ablesbar — hier steht er. */}
                          <span className="rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-sm text-gray-900">
                            {pin.textColor.toUpperCase()}
                          </span>
                        </span>
                      </label>
                    </div>

                    <label className="mb-2 block">
                      <span className="mb-1 flex items-center justify-between text-xs font-medium text-gray-700">
                        <span>{t.kampagne_pin_title}</span>
                        <span className="text-gray-500">
                          {pin.title.length}/{PIN_TITLE_MAX}
                        </span>
                      </span>
                      <input
                        value={pin.title}
                        onChange={(e) => updatePin(pin.id, 'title', e.target.value)}
                        maxLength={PIN_TITLE_MAX}
                        className={FIELD_CLASS}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-xs font-medium text-gray-700">
                        <span>{t.kampagne_pin_description}</span>
                        <span className="text-gray-500">
                          {pin.description.length}/{PIN_DESCRIPTION_MAX}
                        </span>
                      </span>
                      <textarea
                        value={pin.description}
                        onChange={(e) => updatePin(pin.id, 'description', e.target.value)}
                        rows={3}
                        maxLength={PIN_DESCRIPTION_MAX}
                        className={FIELD_CLASS}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* Schritt 5 — Etsy-Listing-Entwurf (nur Etsy/Beides) */}
      {includesEtsy && (
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">{t.kampagne_etsy_title}</h2>
              <p className="mt-1 text-xs text-gray-600">{t.kampagne_etsy_hint}</p>
            </div>
            <button
              type="button"
              onClick={onBuildEtsy}
              disabled={!draft.product.trim()}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {etsy ? t.kampagne_etsy_regenerate : t.kampagne_etsy_generate}
            </button>
          </div>

          {copyFailed && (
            <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {t.kampagne_copy_failed}
            </div>
          )}

          {!etsy ? (
            <p className="text-sm text-gray-500">{t.kampagne_etsy_empty}</p>
          ) : (
            <>
              <label className="mb-2 block">
                <span className="mb-1 flex items-center justify-between text-xs font-medium text-gray-700">
                  <span>{t.kampagne_etsy_field_title}</span>
                  <span className="text-gray-500">
                    {etsy.title.length}/{ETSY_TITLE_MAX}
                  </span>
                </span>
                <input
                  value={etsy.title}
                  onChange={(e) => updateEtsy({ title: e.target.value })}
                  maxLength={ETSY_TITLE_MAX}
                  className={FIELD_CLASS}
                />
              </label>
              <button
                type="button"
                onClick={() => void copyText('title', etsy.title)}
                className="mb-4 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied === 'title' ? t.kampagne_copied : t.kampagne_copy_title}
              </button>

              <label className="mb-2 block">
                <span className="mb-1 flex items-center justify-between text-xs font-medium text-gray-700">
                  <span>{t.kampagne_etsy_field_description}</span>
                  <span className="text-gray-500">
                    {etsy.description.length}/{ETSY_DESCRIPTION_MAX}
                  </span>
                </span>
                <textarea
                  value={etsy.description}
                  onChange={(e) => updateEtsy({ description: e.target.value })}
                  rows={6}
                  maxLength={ETSY_DESCRIPTION_MAX}
                  className={FIELD_CLASS}
                />
              </label>
              <button
                type="button"
                onClick={() => void copyText('description', etsy.description)}
                className="mb-4 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied === 'description' ? t.kampagne_copied : t.kampagne_copy_description}
              </button>

              <label className="mb-2 block">
                <span className="mb-1 flex items-center justify-between text-xs font-medium text-gray-700">
                  <span>{t.kampagne_etsy_field_tags}</span>
                  <span className={etsyTagsComplete(etsy.tags) ? 'text-green-700' : 'text-amber-700'}>
                    {etsy.tags.length}/{ETSY_TAG_COUNT} {t.kampagne_etsy_tags_count}
                  </span>
                </span>
                <textarea
                  value={tagText}
                  onChange={(e) => onTagTextChange(e.target.value)}
                  rows={6}
                  className={FIELD_CLASS}
                />
                <span className="mt-1 block text-xs text-gray-500">{t.kampagne_etsy_tags_hint}</span>
              </label>

              <ul className="mb-3 flex flex-wrap gap-2">
                {etsy.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                    title={`${tag.length}/${ETSY_TAG_MAX_CHARS}`}
                  >
                    {tag}
                  </li>
                ))}
              </ul>

              {!etsyTagsComplete(etsy.tags) && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {t.kampagne_etsy_tags_short}
                </p>
              )}

              <button
                type="button"
                onClick={() => void copyText('tags', formatTagList(etsy.tags))}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied === 'tags' ? t.kampagne_copied : t.kampagne_copy_tags}
              </button>
            </>
          )}
        </section>
      )}

      {exportError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {t.kampagne_export_failed}
        </div>
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
          onClick={() => void onExportZip()}
          disabled={exporting !== null || pins.length === 0}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {exporting === 'zip' ? t.kampagne_export_busy : t.kampagne_export_zip}
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

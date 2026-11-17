// ─────────────────────────────────────────────────────────────────────────────
// „Pin-Bild erstellen" im Pinterest-Ergebnis (2026-11-17)
// ─────────────────────────────────────────────────────────────────────────────
// Der Nutzer hat den Pinterest-Text fertig. Dieser Knopf legt EIN Pin-Bild
// daneben — ohne Neueingabe:
//   1. `buildPinImagePrompt` beschreibt das Hintergrundbild aus Pin-Titel,
//      Pin-Text und Produktangaben (nichts erfunden, kein Text im Bild).
//   2. `POST /api/image/stream` erzeugt genau EIN Bild (dort läuft die
//      bestehende Quota-Kette: 1 Bild = 1 Einheit, keine neue Zählung).
//   3. `renderPinsServer` → `renderPinPng` setzt Überschrift + Layout als
//      1000 × 1500-PNG darauf (deterministisch, fünf Layouts, Logo/Schrift aus
//      dem Markenprofil). KEIN zweiter Modell-Call, keine Kosten fürs Rendern.
//
// Bearbeitbar: Überschrift, Layout. Download: PNG. Der Doppelklick-Riegel
// verhindert zwei bezahlte Läufe für dasselbe Bild.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '~/i18n';
import { PIN_LAYOUT_IDS, type PinLayoutId } from '~/lib/kampagne/pin-render';
import {
  PIN_DESCRIPTION_MAX,
  PIN_HEADLINE_MAX,
  PIN_TITLE_MAX,
  clip,
  type PinDraft,
} from '~/lib/kampagne/pin-drafts';
import { renderPinsServer, type PinBrandInput } from '~/lib/kampagne/pin-server';
import { buildPinImagePrompt } from '~/lib/kampagne/pin-image-prompt';
import {
  ImageStreamServerError,
  ImageStreamUnavailableError,
  runImageStream,
} from '~/lib/image-studio-stream';
import { refreshUsage } from '~/lib/usage-client';
import { getBrandProfile } from '~/store/brand';

export interface PinImageFromTextProps {
  /** Pinterest-Titel aus dem fertigen Ergebnis. */
  title: string;
  /** Pinterest-Beschreibung/-Text aus dem fertigen Ergebnis. */
  description: string;
  /** Produktangaben aus dem Ideenfeld (dieselben, aus denen der Text entstand). */
  productIdea: string;
}

/** Layout-Kennungen → kurze Beschriftung (Reihenfolge = fünf Entwürfe). */
const LAYOUT_LABELS: Record<PinLayoutId, string> = {
  'bottom-left': '1',
  'top-band': '2',
  'center-card': '3',
  'side-stripe': '4',
  'minimal-frame': '5',
};

/** Markenprofil zum Klickzeitpunkt lesen — was es nicht hergibt, wird nicht erfunden. */
function brandInput(): PinBrandInput {
  const profile = getBrandProfile();
  if (!profile) return { applied: false };
  return {
    applied: profile.enabled !== false,
    colors: profile.brandColors,
    name: profile.brandName,
    logo: profile.logo,
    fontId: profile.fontId,
  };
}

export function PinImageFromText({ title, description, productIdea }: PinImageFromTextProps) {
  const { t } = useTranslation();
  const [headline, setHeadline] = useState(() => clip(title, PIN_HEADLINE_MAX));
  const [layout, setLayout] = useState<PinLayoutId>('bottom-left');
  const [photo, setPhoto] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [renderedHeadline, setRenderedHeadline] = useState('');
  const [busy, setBusy] = useState<'image' | 'render' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = useMemo<PinDraft>(
    () => ({
      id: 'pin-bild',
      layout,
      headline: clip(headline, PIN_HEADLINE_MAX),
      subline: '',
      textColor: '#ffffff',
      align: 'left',
      offsetY: 0,
      title: clip(title, PIN_TITLE_MAX),
      description: clip(description, PIN_DESCRIPTION_MAX),
    }),
    [headline, layout, title, description],
  );

  /** Deterministischer Renderer — kostet nichts, daher bei jeder Änderung erlaubt. */
  const renderPin = useCallback(
    async (photoUrl: string, next: PinDraft): Promise<boolean> => {
      setBusy('render');
      setError(null);
      try {
        const res = await renderPinsServer({
          data: { photoDataUrl: photoUrl, brand: brandInput(), pins: [next] },
        });
        const first = res.pins[0];
        if (!first) throw new Error('render_failed');
        setPng(first.dataUrl);
        setRenderedHeadline(next.headline);
        return true;
      } catch (err) {
        // Ehrlich: das Bild ist erzeugt (und gebucht), der Text passt aber nicht
        // darauf — es gibt KEIN halbes Pin und keine stille Kürzung.
        setError(
          `${t.pinimg_error_render} (${err instanceof Error ? err.message : 'render_failed'})`,
        );
        return false;
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  const create = useCallback(async () => {
    // Doppelklick-Riegel: ein bezahlter Lauf für ein Bild.
    if (busy) return;
    if (!headline.trim()) {
      setError(t.pinimg_error_text_required);
      return;
    }
    const prompt = buildPinImagePrompt({ title, description, productIdea });
    if (!prompt) {
      setError(t.pinimg_error_no_input);
      return;
    }
    setError(null);
    setPng(null);
    setPartial(null);
    setBusy('image');
    try {
      const done = await runImageStream({
        body: { prompt, aspectRatio: '2:3' },
        onPartial: (p) => setPartial(p.dataUrl),
      });
      // Das Bild ist erzeugt und gebucht — der Zähler wird sofort nachgezogen,
      // auch wenn das Rendern danach scheitert.
      refreshUsage();
      setPhoto(done.url);
      await renderPin(done.url, draft);
    } catch (err) {
      if (err instanceof ImageStreamUnavailableError) {
        setError(t.pinimg_error_unavailable);
      } else if (err instanceof ImageStreamServerError) {
        setError(`${t.pinimg_error_image} ${err.message}`.trim());
      } else {
        setError(t.pinimg_error_image);
      }
    } finally {
      setPartial(null);
      setBusy(null);
    }
  }, [busy, headline, title, description, productIdea, draft, renderPin, t]);

  const applyHeadline = useCallback(() => {
    if (!photo || busy) return;
    void renderPin(photo, draft);
  }, [photo, busy, draft, renderPin]);

  const chooseLayout = useCallback(
    (id: PinLayoutId) => {
      setLayout(id);
      if (!photo) return;
      void renderPin(photo, { ...draft, layout: id });
    },
    [photo, draft, renderPin],
  );

  const dirty = png !== null && draft.headline !== renderedHeadline;

  return (
    <div className="flex w-full flex-wrap items-center gap-3">
      <button
        type="button"
        data-testid="pin-image-create"
        onClick={() => void create()}
        disabled={busy !== null}
        className="inline-flex items-center gap-2 rounded-xl border border-purple-300 bg-white px-5 py-2.5 text-sm font-semibold text-purple-700 shadow-sm transition-all hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        🖼️ {busy === 'image' ? t.pinimg_working : t.pinimg_create}
      </button>
      {png === null && busy === null && (
        <span className="text-xs text-gray-500">{t.pinimg_hint}</span>
      )}

      {(partial || png) && (
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-[180px] shrink-0">
              <img
                src={png ?? partial ?? ''}
                alt={t.pinimg_preview_alt}
                className="w-full rounded-lg border border-gray-200"
              />
              <p className="mt-1 text-center text-[11px] text-gray-500">
                1000 × 1500 px{busy === 'render' ? ` · ${t.kampagne_pin_rendering}` : ''}
              </p>
            </div>

            <div className="min-w-[220px] flex-1 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-700">
                  {t.kampagne_pin_overlay}
                </span>
                <input
                  type="text"
                  data-testid="pin-image-headline"
                  value={headline}
                  maxLength={PIN_HEADLINE_MAX}
                  onChange={(e) => setHeadline(e.target.value)}
                  disabled={busy !== null}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                />
              </label>

              <div>
                <span className="mb-1 block text-xs font-semibold text-gray-700">
                  {t.pinimg_layout}
                </span>
                <div className="flex flex-wrap gap-2">
                  {PIN_LAYOUT_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => chooseLayout(id)}
                      disabled={busy !== null}
                      aria-pressed={layout === id}
                      className={`h-8 w-8 rounded-lg text-xs font-semibold transition-all ${
                        layout === id
                          ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {LAYOUT_LABELS[id]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {dirty && (
                  <button
                    type="button"
                    data-testid="pin-image-apply"
                    onClick={applyHeadline}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.pinimg_apply}
                  </button>
                )}
                {png && (
                  <a
                    href={png}
                    download="pin-1000x1500.png"
                    data-testid="pin-image-download"
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-200 hover:from-blue-700 hover:to-purple-700"
                  >
                    {t.kampagne_export_png}
                  </a>
                )}
              </div>
            </div>
          </div>

          {error && (
            <p
              data-testid="pin-image-error"
              className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {error}
            </p>
          )}
        </div>
      )}

      {error && !partial && !png && (
        <p
          data-testid="pin-image-error"
          className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {error}
        </p>
      )}
    </div>
  );
}

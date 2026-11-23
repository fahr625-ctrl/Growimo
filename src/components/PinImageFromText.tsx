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
// VORABPRÜFUNG (2026-11-18): 3 von 4 Läufen lieferten kein Bild, weil der
// Renderer den Text erst NACH dem bezahlten KI-Bild verwarf (`text_overflow`).
// Jetzt prüft `checkPinTextServer` den Text gegen das GEWÄHLTE Layout, BEVOR
// `/api/image/stream` überhaupt aufgerufen wird — mit demselben Mess-Lauf, den
// der Renderer benutzt. Passt der Text nicht: kein Request, keine Einheit, und
// sofort ein Kürzungsvorschlag (übernehmen oder selbst bearbeiten). Der Knopf
// bleibt gesperrt, solange der Text nicht passt, und sagt warum.
//
// Ein bereits erzeugtes Bild bleibt erhalten: der Text lässt sich ändern und
// ohne neuen KI-Aufruf neu rendern (kostet keine Einheit).
//
// Bearbeitbar: Überschrift, Layout. Download: PNG. Der Doppelklick-Riegel
// verhindert zwei bezahlte Läufe für dasselbe Bild.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '~/i18n';
import { PIN_LAYOUT_IDS, type PinLayoutId } from '~/lib/kampagne/pin-render';
import {
  PIN_DESCRIPTION_MAX,
  PIN_HEADLINE_MAX,
  PIN_TITLE_MAX,
  clip,
  type PinDraft,
} from '~/lib/kampagne/pin-drafts';
import {
  PIN_RENDER_BODY_LIMIT_BYTES,
  checkPinTextServer,
  estimatePinRenderBodyBytes,
  renderPinsServer,
  type PinBrandInput,
} from '~/lib/kampagne/pin-server';
import { buildPinImagePrompt } from '~/lib/kampagne/pin-image-prompt';
import {
  ImageStreamServerError,
  ImageStreamUnavailableError,
  runImageStream,
} from '~/lib/image-studio-stream';
import { refreshUsage } from '~/lib/usage-client';
import { loadPinState, pinFingerprint, savePinState } from '~/lib/pin-image-state';
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

/**
 * Wählbare Textfarben der Überschrift (2026-11-22): zwei helle und zwei dunkle
 * Töne — mehr braucht es nicht, weil die Textfläche automatisch zur Farbe
 * gewählt wird. Jede Wahl rendert nur neu (`renderPinPng`), kostet also KEINE
 * Einheit und ruft kein KI-Modell auf.
 */
const PIN_TEXT_COLORS: { id: string; hex: string; labelKey: 'pinimg_color_white' | 'pinimg_color_cream' | 'pinimg_color_anthracite' | 'pinimg_color_black' }[] = [
  { id: 'white', hex: '#ffffff', labelKey: 'pinimg_color_white' },
  { id: 'cream', hex: '#f8fafc', labelKey: 'pinimg_color_cream' },
  { id: 'anthracite', hex: '#111827', labelKey: 'pinimg_color_anthracite' },
  { id: 'black', hex: '#000000', labelKey: 'pinimg_color_black' },
];

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

/**
 * Ergebnis der Vorabprüfung. `checking` sperrt den Knopf (noch nicht geprüft),
 * `blocked` sperrt ihn mit Grund + Kürzungsvorschlag, `unknown` heißt: die
 * Prüfung selbst war nicht erreichbar — dann entscheidet der Klick (dort wird
 * erneut geprüft, und ohne Ergebnis wird nichts erzeugt).
 */
type FitState =
  | { status: 'checking' }
  | { status: 'ok'; text: string; layout: PinLayoutId }
  | { status: 'unknown' }
  | {
      status: 'blocked';
      text: string;
      layout: PinLayoutId;
      message: string | null;
      suggestion: string | null;
    };

export function PinImageFromText({ title, description, productIdea }: PinImageFromTextProps) {
  const { t } = useTranslation();
  const [headline, setHeadline] = useState(() => clip(title, PIN_HEADLINE_MAX));
  const [layout, setLayout] = useState<PinLayoutId>('bottom-left');
  /** Textfarbe der Überschrift (2026-11-22) — jeder Wechsel rendert nur neu. */
  const [textColor, setTextColor] = useState<string>('#ffffff');
  const [photo, setPhoto] = useState<string | null>(null);
  /**
   * 2026-11-22: Das erzeugte Bild wird nur noch REFERENZIERT, nicht mehr durch
   * den Request-Body geschickt (ein 3,78-MB-PNG als Data-URL sprengte das
   * 4,5-MB-Limit von Vercel ⇒ HTTP 413, bevor der Renderer lief). `imageId` ist
   * die `generated_images.id` des gespeicherten Originals; `photo` bleibt für
   * die Anzeige im Browser.
   */
  const [photoId, setPhotoId] = useState<string | null>(null);
  const photoSourceRef = useRef<{ dataUrl: string; imageId: string | null } | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [renderedHeadline, setRenderedHeadline] = useState('');
  /** Sichtbarer Hinweis, wenn der Kontrast automatisch gerettet wurde. */
  const [contrastNotice, setContrastNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'image' | 'render' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<FitState>({ status: 'checking' });
  const [suggestionHidden, setSuggestionHidden] = useState(false);
  const headlineRef = useRef<HTMLInputElement | null>(null);
  /**
   * 2026-11-23: Der Zustand überlebt das Neuladen. Gespeichert wird die
   * Bild-Referenz (`generated_images.id`) plus Überschrift, Textfarbe und
   * Layout — der Fingerabdruck ordnet ihn genau diesem Pin zu.
   */
  const fingerprint = useMemo(() => pinFingerprint(title, description), [title, description]);
  const restoreRanRef = useRef(false);

  const draft = useMemo<PinDraft>(
    () => ({
      id: 'pin-bild',
      layout,
      headline: clip(headline, PIN_HEADLINE_MAX),
      subline: '',
      textColor,
      align: 'left',
      offsetY: 0,
      title: clip(title, PIN_TITLE_MAX),
      description: clip(description, PIN_DESCRIPTION_MAX),
    }),
    [headline, layout, textColor, title, description],
  );

  /**
   * Vorabprüfung gegen das gewählte Layout — derselbe Mess-Lauf wie im
   * Renderer, ohne KI-Aufruf, ohne Einheit. Gibt den Zustand zurück, damit der
   * Klick-Pfad dasselbe Ergebnis benutzen kann (kein zweiter Weg).
   */
  const checkText = useCallback(
    async (text: string, layoutId: PinLayoutId): Promise<FitState> => {
      try {
        const res = await checkPinTextServer({
          data: { title: text, layout: layoutId, brand: brandInput() },
        });
        if (res.fits) return { status: 'ok', text, layout: layoutId };
        return {
          status: 'blocked',
          text,
          layout: layoutId,
          message: res.message,
          suggestion: res.suggestion,
        };
      } catch {
        return { status: 'unknown' };
      }
    },
    [],
  );

  // Bei jeder Text-/Layout-Änderung prüfen (kurz entprellt: Tippen soll nicht
  // bei jedem Zeichen eine Messung auslösen).
  useEffect(() => {
    const text = clip(headline, PIN_HEADLINE_MAX);
    let cancelled = false;
    setFit({ status: 'checking' });
    const timer = setTimeout(() => {
      void checkText(text, layout).then((next) => {
        if (!cancelled) setFit(next);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [headline, layout, checkText]);

  /**
   * Deterministischer Renderer — kostet nichts, daher bei jeder Änderung erlaubt.
   *
   * 2026-11-22: Der Aufruf trägt nur die Bild-REFERENZ (Body wenige hundert
   * Bytes); der Server lädt das gespeicherte Original selbst. Nur wenn das Bild
   * nicht dauerhaft gespeichert wurde, geht der Data-URL-Rückfall raus — und
   * zwar nur, wenn er unter dem gemessenen Body-Limit bleibt. Sonst Klartext
   * statt stillem 413.
   */
  const renderPin = useCallback(
    async (next: PinDraft): Promise<boolean> => {
      const src = photoSourceRef.current;
      if (!src) return false;
      setBusy('render');
      setError(null);
      const payload = {
        ...(src.imageId ? { imageId: src.imageId } : { photoDataUrl: src.dataUrl }),
        brand: brandInput(),
        pins: [next],
      };
      if (estimatePinRenderBodyBytes(payload) > PIN_RENDER_BODY_LIMIT_BYTES) {
        // Das Bild bleibt (es liegt im Browser) — nur das Rendern geht so nicht.
        setError(t.pinimg_error_body_too_large);
        setBusy(null);
        return false;
      }
      try {
        const res = await renderPinsServer({ data: payload });
        const first = res.pins[0];
        if (!first) throw new Error('render_failed');
        setPng(first.dataUrl);
        setRenderedHeadline(next.headline);
        // Sichtbarer Hinweis, wenn der Kontrast automatisch gerettet wurde.
        setContrastNotice(first.contrastNotice ?? null);
        return true;
      } catch (err) {
        // Ehrlich: das Bild ist erzeugt (und gebucht), der Text passt aber nicht
        // darauf — es gibt KEIN halbes Pin und keine stille Kürzung. Das Bild
        // bleibt erhalten und wird neu gerendert, sobald der Text passt: das
        // kostet keine weitere Einheit (kein KI-Aufruf).
        const detail = err instanceof Error ? err.message : 'render_failed';
        // Ein 413 ist kein „der Text passt nicht" — er wird als das benannt, was er ist.
        if (/413|entity too large|payload too large/i.test(detail)) {
          setError(`${t.pinimg_error_body_too_large} (${detail})`);
        } else {
          setError(`${t.pinimg_error_keep} (${detail})`);
        }
        // Warum es nicht passte — mit Kürzungsvorschlag, ohne KI-Aufruf.
        setFit(await checkText(next.headline, next.layout));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [t, checkText],
  );

  /**
   * Wiedergewinnung nach dem Neuladen (2026-11-23). Quelle ist das GESPEICHERTE
   * Bild: `GET /api/images/<id>` liefert die Pixel aus dem Bildspeicher, der
   * Renderer nimmt dieselbe Referenz. Kein KI-Aufruf, keine Einheit — das Bild
   * ist bereits bezahlt. Danach setzt der Renderer den Pin kostenlos neu, damit
   * Vorschau und Regler denselben Stand zeigen.
   */
  useEffect(() => {
    if (restoreRanRef.current) return;
    restoreRanRef.current = true;
    const stored = loadPinState();
    // Gehört der Eintrag zu einem anderen Pin-Text: nicht anfassen.
    if (!stored || stored.key !== fingerprint) return;

    const nextHeadline = clip(stored.headline, PIN_HEADLINE_MAX);
    const nextColor = PIN_TEXT_COLORS.some((c) => c.hex === stored.textColor)
      ? stored.textColor
      : '#ffffff';
    const nextLayout = (PIN_LAYOUT_IDS as readonly string[]).includes(stored.layout)
      ? stored.layout
      : 'bottom-left';
    const url = `/api/images/${stored.imageId}`;

    setHeadline(nextHeadline);
    setTextColor(nextColor);
    setLayout(nextLayout);
    photoSourceRef.current = { dataUrl: url, imageId: stored.imageId };
    setPhoto(url);
    setPhotoId(stored.imageId);

    // Fehlt das Bild im Speicher, sagt der Baustein das im Klartext — statt
    // still ein leeres Feld zu zeigen.
    const probe = new Image();
    probe.onerror = () => setError(t.pinimg_restore_missing);
    probe.src = url;

    void renderPin({
      id: 'pin-bild',
      layout: nextLayout,
      headline: nextHeadline,
      subline: '',
      textColor: nextColor,
      align: 'left',
      offsetY: 0,
      title: clip(title, PIN_TITLE_MAX),
      description: clip(description, PIN_DESCRIPTION_MAX),
    });
    // Nur beim ersten Rendern des Bausteins — danach ist der Nutzer am Zug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jede Änderung mitschreiben, sobald ein Bild da ist — der nächste Reload
  // findet genau diesen Stand (Bild-Referenz, Überschrift, Textfarbe, Layout).
  useEffect(() => {
    if (!photoId) return;
    savePinState({
      key: fingerprint,
      imageId: photoId,
      headline,
      textColor,
      layout,
      savedAt: Date.now(),
    });
  }, [photoId, fingerprint, headline, textColor, layout]);

  const create = useCallback(async () => {
    // Doppelklick-Riegel: ein bezahlter Lauf für ein Bild.
    if (busy) return;
    const text = clip(headline, PIN_HEADLINE_MAX);
    if (!text.trim()) {
      setError(t.pinimg_error_text_required);
      return;
    }
    const prompt = buildPinImagePrompt({ title, description, productIdea });
    if (!prompt) {
      setError(t.pinimg_error_no_input);
      return;
    }

    // 1) VORABPRÜFUNG — VOR jedem KI-Aufruf. Passt der Text nicht: kein
    //    Request auf /api/image/stream, keine Einheit, nur Grund + Vorschlag.
    if (!(fit.status === 'ok' && fit.text === text && fit.layout === layout)) {
      setBusy('check');
      const next = await checkText(text, layout);
      setBusy(null);
      setFit(next);
      if (next.status === 'blocked') {
        setError(null);
        setSuggestionHidden(false);
        return;
      }
      if (next.status === 'unknown') {
        // Ohne Prüfung kein bezahlter Lauf — sonst wäre die Einheit weg, ohne
        // dass jemand weiß, ob das Bild überhaupt entstehen kann.
        setError(t.pincheck_error);
        return;
      }
    }

    setError(null);
    setPng(null);
    setPartial(null);
    setContrastNotice(null);
    setBusy('image');
    try {
      const done = await runImageStream({
        body: { prompt, aspectRatio: '2:3' },
        onPartial: (p) => setPartial(p.dataUrl),
      });
      // Das Bild ist erzeugt und gebucht — der Zähler wird sofort nachgezogen,
      // auch wenn das Rendern danach scheitert. Das Bild bleibt erhalten.
      refreshUsage();
      // 2026-11-22: Data-URL nur für die Anzeige, der Render-Aufruf nimmt die
      // Referenz (`done.imageId`) — so bleibt der Body klein, egal wie groß das Bild ist.
      photoSourceRef.current = { dataUrl: done.url, imageId: done.imageId ?? null };
      setPhoto(done.url);
      setPhotoId(done.imageId ?? null);
      await renderPin(draft);
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
  }, [busy, headline, title, description, productIdea, draft, renderPin, t, fit, layout, checkText]);

  const applyHeadline = useCallback(() => {
    if (!photo || busy) return;
    void renderPin(draft);
  }, [photo, busy, draft, renderPin]);

  const chooseLayout = useCallback(
    (id: PinLayoutId) => {
      setLayout(id);
      setSuggestionHidden(false);
      if (!photo) return;
      void renderPin({ ...draft, layout: id });
    },
    [photo, draft, renderPin],
  );

  /**
   * Textfarbe wechseln (2026-11-22): rendert das VORHANDENE Bild neu — kein
   * KI-Aufruf, keine Einheit, beliebig oft. Reicht der Kontrast nicht, rettet
   * der Renderer die Farbe selbst und der Hinweis erscheint unter dem Bild.
   */
  const chooseTextColor = useCallback(
    (hex: string) => {
      setTextColor(hex);
      if (!photo) return;
      void renderPin({ ...draft, textColor: hex });
    },
    [photo, draft, renderPin],
  );

  /** Kürzungsvorschlag übernehmen — danach prüft die Vorabprüfung erneut. */
  const acceptSuggestion = useCallback(() => {
    if (fit.status !== 'blocked' || !fit.suggestion) return;
    setHeadline(fit.suggestion);
    setSuggestionHidden(true);
    setError(null);
  }, [fit]);

  const chooseSelf = useCallback(() => {
    setSuggestionHidden(true);
    headlineRef.current?.focus();
  }, []);

  const dirty = (png !== null || photo !== null) && draft.headline !== renderedHeadline;
  const blocked = fit.status === 'blocked';
  const checking = busy === 'check' || fit.status === 'checking';

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="pin-image-create"
          onClick={() => void create()}
          disabled={busy !== null || checking || blocked}
          className="inline-flex items-center gap-2 rounded-xl border border-purple-300 bg-white px-5 py-2.5 text-sm font-semibold text-purple-700 shadow-sm transition-all hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          🖼️ {busy === 'image' ? t.pinimg_working : t.pinimg_create}
        </button>
        {png === null && busy === null && (
          <span className="text-xs text-gray-500">{t.pinimg_hint}</span>
        )}
      </div>

      {/* Vorabprüfung: Grund und Kürzungsvorschlag — VOR dem KI-Aufruf sichtbar. */}
      {checking && (
        <p data-testid="pin-text-checking" className="text-xs text-gray-500">
          {t.pincheck_checking}
        </p>
      )}
      {blocked && (
        <div
          data-testid="pin-text-block"
          className="w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <p className="font-semibold">{t.pincheck_blocked}</p>
          {fit.message && (
            <p data-testid="pin-text-block-reason" className="mt-1">
              {fit.message}
            </p>
          )}
          {fit.suggestion && !suggestionHidden && (
            <div className="mt-2" data-testid="pin-text-suggestion-box">
              <p>{t.pincheck_suggestion_label}</p>
              <p data-testid="pin-text-suggestion" className="mt-1 italic">
                „{fit.suggestion}"
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="pin-text-suggestion-accept"
                  onClick={acceptSuggestion}
                  disabled={busy !== null}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t.pincheck_accept}
                </button>
                <button
                  type="button"
                  data-testid="pin-text-suggestion-edit"
                  onClick={chooseSelf}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-800 hover:bg-amber-100"
                >
                  {t.pincheck_edit_self}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Text + Layout: immer bedienbar — „selbst bearbeiten" geht auch ohne Bild. */}
      <div className="flex w-full flex-wrap items-end gap-3">
        <label className="min-w-[240px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-gray-700">
            {t.kampagne_pin_overlay}
          </span>
          <input
            ref={headlineRef}
            type="text"
            data-testid="pin-image-headline"
            value={headline}
            maxLength={PIN_HEADLINE_MAX}
            onChange={(e) => {
              setHeadline(e.target.value);
              setSuggestionHidden(false);
            }}
            disabled={busy !== null}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
          />
        </label>

        <div>
          <span className="mb-1 block text-xs font-semibold text-gray-700">{t.pinimg_layout}</span>
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

        {/* Textfarbe der Überschrift (2026-11-22): angewandt auf das vorhandene
            Bild, ohne KI-Aufruf und ohne Einheit — beliebig oft änderbar. */}
        <div>
          <span className="mb-1 block text-xs font-semibold text-gray-700">
            {t.pinimg_text_color}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {PIN_TEXT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                data-testid={`pin-image-color-${color.id}`}
                onClick={() => chooseTextColor(color.hex)}
                disabled={busy !== null}
                aria-pressed={textColor === color.hex}
                aria-label={t[color.labelKey]}
                title={t[color.labelKey]}
                className={`h-8 w-8 rounded-full border-2 transition-all ${
                  textColor === color.hex
                    ? 'border-purple-600 ring-2 ring-purple-300'
                    : 'border-gray-300 hover:border-gray-400'
                } disabled:cursor-not-allowed disabled:opacity-60`}
                style={{ backgroundColor: color.hex }}
              />
            ))}
          </div>
          <p className="mt-1 max-w-[220px] text-[11px] text-gray-500">{t.pinimg_color_hint}</p>
        </div>
      </div>

      {(partial || png || photo) && (
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-[180px] shrink-0">
              <img
                src={png ?? partial ?? photo ?? ''}
                alt={png ? t.pinimg_preview_alt : t.pinimg_photo_alt}
                data-photo-image-id={photoId ?? ''}
                className="w-full rounded-lg border border-gray-200"
              />
              <p className="mt-1 text-center text-[11px] text-gray-500">
                1000 × 1500 px{busy === 'render' ? ` · ${t.kampagne_pin_rendering}` : ''}
              </p>
            </div>

            <div className="min-w-[220px] flex-1 space-y-3">
              {/* Kontrast-Rettung sichtbar machen (2026-11-22): der Pin entsteht
                  trotzdem, hier steht, was angepasst wurde. */}
              {contrastNotice && (
                <p
                  data-testid="pin-image-contrast-notice"
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  {contrastNotice}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {dirty && (
                  <button
                    type="button"
                    data-testid="pin-image-apply"
                    onClick={applyHeadline}
                    disabled={busy !== null || checking || blocked}
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

              {error && (
                <p
                  data-testid="pin-image-error"
                  className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {error && !partial && !png && !photo && (
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

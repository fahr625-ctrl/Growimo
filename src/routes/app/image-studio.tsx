import { createFileRoute, Link } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ProtectedRoute } from '~/components/ProtectedRoute';
import { useTranslation } from '~/i18n';
import { trackAnalytics } from '~/lib/analytics-client';
import { classifyGenerationError } from '~/lib/analytics-error';
import { track } from '~/lib/tracking-client';
import { getProjectsByUser, type Project } from '~/store/projects';
import { isImageAspectRatio, type GeneratedImage, type ImageAspectRatio } from '~/ai/image-providers/types';
import { readStrategyPrefill, type StrategyImagePayload } from '~/lib/strategy-image';
import { getBrandProfile } from '~/store/brand';
import { contentTypeLabel } from '~/lib/content-types';
import {
  composeStrategyStudioPrompt,
  composeTextOverlayInstructions,
  formatStrategyBrandContext,
  resolveStudioPrefill,
  type StudioPromptRules,
} from '~/lib/studio-deeplink';
// Stabilisierung Schritt 3 (Punkt 3) — Referenzbild-Kette.
import {
  composePromptWithReferenceLock,
  sanitizeReferenceImageData,
  type ImageRunMode,
} from '~/ai/image-providers/reference';
import {
  pickStrategyReferenceImage,
  readFileAsDataUrl,
  shrinkReferenceImage,
  type UploadEntry,
} from '~/lib/image-reference';
import {
  capGallery,
  guardImageRun,
  IMAGE_CLIENT_TIMEOUT_MS,
  IMAGE_GALLERY_MAX,
  type ImageAbortReason,
} from '~/lib/image-safeguards';
// Phase 5d (Fund 3) — versionierte sessionStorage-Persistenz der Galerie.
import { persistGallery, readGallery } from '~/lib/image-gallery';
// Option 1 (Bild-Latenz, Owner-Freigabe 2026-10-07) — SSE-Client: echte
// Zwischenbilder der Route /api/image/stream (Partial Images von gpt-image-2).
import { runStudioImage } from '~/lib/image-studio-stream';

/** Studio-Bild inkl. Herkunfts-Flag: `preview === true` heißt „aus der
 *  sessionStorage-Persistenz wiederhergestellte, verkleinerte Vorschau"
 *  (nicht das Original-Datenbild der laufenden Sitzung). */
type StudioImage = GeneratedImage & { preview?: boolean };

// Stabilisierung Schritt 3 (Punkt 3): Der Validator akzeptiert jetzt zusätzlich
// `referenceImageData` (data-URL des Produkt-/Vorlagenbilds). Ein ungültiger
// Wert wird auf `undefined` normalisiert (fail-closed → Text→Bild statt eines
// kaputten Requests an OpenAI). Damit kann die Bildidentität überhaupt erst
// durch die ServerFn reisen — vorher war sie hier hart abgeschnitten.
const generateImageServer = createServerFn({ method: 'POST' }).validator((input: unknown) => {
  const raw = (input ?? {}) as { prompt?: unknown; aspectRatio?: unknown; referenceImageData?: unknown };
  return {
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    aspectRatio: typeof raw.aspectRatio === 'string' ? raw.aspectRatio : '1:1',
    referenceImageData: sanitizeReferenceImageData(raw.referenceImageData),
  };
}).handler(async ({ data }) => {
  // Phase 8.2 — 1 Bild = 1 Generierung (nur bei erfolgreichem Bild); Identität
  // aus der Session (Cookie), fail-closed ohne gültige Sitzung.
  const guard = await import('~/lib/usage-guard');
  const userId = await guard.resolveUserIdFromServerFn();
  if (!userId) throw new Error('Keine gültige Sitzung — bitte neu anmelden.');
  await guard.assertRateOk(userId);
  const { generateImage } = await import('~/ai/image-providers/generate');
  // Mit Referenz läuft `generateImage` über images.edit (Produkt bleibt
  // identisch) — die Entscheidung selbst liegt in imageRunMode (testbar).
  return guard.withGenerationGuard(userId, () =>
    generateImage(data.prompt, data.aspectRatio, data.referenceImageData),
  );
});

export const Route = createFileRoute('/app/image-studio')({ component: ImageStudioPage });

const templates = [
  ['2:3', 'image_studio_template_pinterest', 'image_studio_prompt_base_pinterest'],
  ['4:3', 'image_studio_template_etsy', 'image_studio_prompt_base_etsy'],
  ['1:1', 'image_studio_template_instagram', 'image_studio_prompt_base_instagram'],
  ['16:9', 'image_studio_template_blog', 'image_studio_prompt_base_blog'],
  // Schritt 3 (Owner-Freigabe 2026-10-07): Hochkant-Format 9:16 — TikTok/Reels/
  // Shorts. „Blog-Hero" bleibt bewusst 16:9.
  ['9:16', 'image_studio_template_tiktok', 'image_studio_prompt_base_tiktok'],
] as const;
const aspectClass = (ratio: string) => ratio === '2:3' ? 'aspect-[2/3]' : ratio === '4:3' ? 'aspect-[4/3]' : ratio === '16:9' ? 'aspect-video' : ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-square';

// Distinct variation directions. Each one explicitly instructs a different
// combination of composition/perspective/lighting/depth-of-field while the
// main subject, style and format stay identical. They rotate deterministically
// per click (see runCardAction + variationCounter) so repeated taps produce
// visibly different alternates instead of near-identical frames.
/** Schritt 4 (Owner-Freigabe 2026-10-07) — Text-im-Bild-Regeln für den
 *  Studio-Prompt: gequoteter Bildtext statt Prosa, deutsche Schriftzeichen,
 *  eine Schriftfamilie, Safe-Bereich, plus Negativ-Baustein. */
function studioPromptRules(t: ReturnType<typeof useTranslation>['t']): StudioPromptRules {
  return {
    overlay: t.image_studio_prompt_rule_overlay,
    noText: t.image_studio_prompt_rule_no_text,
    typography: t.image_studio_prompt_rule_typography,
    negatives: t.image_studio_prompt_rule_negatives,
  };
}
const variationDirectionKeys = [
  'image_studio_prompt_variant_1',
  'image_studio_prompt_variant_2',
  'image_studio_prompt_variant_3',
  'image_studio_prompt_variant_4',
  'image_studio_prompt_variant_5',
  'image_studio_prompt_variant_6',
] as const;

function StrategyStamp({ t, prefill }: { t: ReturnType<typeof useTranslation>['t']; prefill: StrategyImagePayload }) {
  const profile = getBrandProfile();
  const infoChip = (label: string, value: string) => (
    <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{label}</p>
      <p className="mt-0.5 break-words text-xs text-gray-700">{value || '—'}</p>
    </div>
  );
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">✓</span>
        <span className="text-sm font-bold text-emerald-800">{t.image_studio_from_strategy_badge}</span>
        <span className="ml-auto rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">{prefill.ratio}</span>
      </div>
      <p className="mt-1.5 text-xs text-emerald-700">{t.image_studio_from_strategy_info}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {infoChip(t.image_studio_strategy_platform, prefill.platform)}
        {prefill.productIdea && infoChip(t.image_studio_strategy_product, prefill.productIdea)}
        {prefill.overlay && infoChip(t.image_studio_strategy_overlay, prefill.overlay)}
        {/* Schritt 3 (Punkt 5): Wird ein Produktbild als Referenz mitgegeben,
            steht das sichtbar hier — kein stiller Edit-Pfad. */}
        <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2" data-testid="image-studio-strategy-reference">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{t.image_studio_strategy_reference}</p>
          <p className="mt-0.5 break-words text-xs text-gray-700">
            {prefill.referenceImage ? t.image_studio_reference_sent_hint : t.image_studio_strategy_reference_none}
          </p>
        </div>
        <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2 sm:col-span-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{t.image_studio_strategy_concept}</p>
          <p className="mt-0.5 break-words whitespace-pre-wrap text-xs text-gray-700">{prefill.concept || '—'}</p>
        </div>
        {(prefill.brandInfo || profile?.brandName || profile?.brandColors) ? (
          <div className="min-w-0 rounded-lg bg-white/70 px-3 py-2 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{t.image_studio_strategy_brand}</p>
            <p className="mt-0.5 break-words text-xs text-gray-700">
              {prefill.brandInfo || [profile?.brandName, profile?.brandColors].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
function ImageStudioPage() {
 return <ProtectedRoute><ImageStudioContent /></ProtectedRoute>; }
function ImageStudioContent() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<ImageAspectRatio>('2:3');
  const [images, setImages] = useState<StudioImage[]>([]);
  // Phase 5d — Spiegel der Galerie für die Persistenz: `addImage` braucht den
  // neuen Stand synchron (kein Seiteneffekt im setState-Updater).
  const imagesRef = useRef<StudioImage[]>([]);
  // Phase 5d — Anzahl der aus der Session wiederhergestellten Bilder (Hinweis).
  const [restoredCount, setRestoredCount] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(false);
  // Phase 3.1 — Grund des Fehlers für die ehrliche Meldung: Timeout (Guard),
  // Nutzer-Abbruch oder generischer Fehler (Server/Limit/Download).
  const [errorKind, setErrorKind] = useState<ImageAbortReason | 'generic' | null>(null);
  // Phase 3.1 — laufender guardImageRun (für den „Abbrechen“-Button).
  const runGuardRef = useRef<{ abort: (reason?: ImageAbortReason) => void } | null>(null);
  // Phase 3.4 — Anzahl erzeugter Bilder insgesamt (auch der aus der Galerie
  // herausgefallenen) → Hinweis auf die Speicher-Begrenzung.
  const [generatedCount, setGeneratedCount] = useState(0);
  // Phase 3.3d — Einstieg über den TikTok-Deep-Link (?prompt=): Rückweg anbieten.
  const [fromTikTok, setFromTikTok] = useState(false);
  // Phase 8.2 — konkrete Serverseiten-Meldung (z. B. Limit erreicht) im Banner.
  const [usageError, setUsageError] = useState<string | null>(null);
  // Option 1 — letztes Zwischenbild des laufenden Streaming-Laufs. null = noch
  // keins angekommen → normales Warten (Skeleton), kein Streaming-Hinweis. Das
  // ist die ehrliche Variante: der Hinweis erscheint nur, wenn wirklich ein
  // verfeinerter Zwischenstand da ist (nicht beim fail-closed-Fallback).
  const [streamPreview, setStreamPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: 'variation' | 'regenerate' } | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  // Stabilisierung Schritt 3 (Punkt 3): Der Upload hält jetzt den ECHTEN
  // Bildinhalt (data-URL) — vorher nur { name, url } (reine Anzeige-URL).
  const [selectedProject, setSelectedProject] = useState('');
  const [strategyPrefill, setStrategyPrefill] = useState<StrategyImagePayload | null>(null);
  // Schritt 3 (Punkt 3): letzter gelaufener Bildpfad — steuert den ehrlichen
  // Hinweis „Referenz wurde mitgesendet" (nie stillschweigend Text→Bild).
  const [lastRunMode, setLastRunMode] = useState<ImageRunMode | null>(null);
  // Deterministic rotation across the variation directions so that consecutive
  // "Variation" clicks never request the same direction (and thus never converge
  // to the same composition via gpt-image-1's similar-prompt fold).
  const variationCounter = useRef(0);

  useEffect(() => {
    // Phase 5d (Fund 3) — Galerie aus der Session wiederherstellen.
    // Die Route wird bei Zurück/Vorwärts, Reload und bfcache-Rückkehr neu
    // gemountet; ohne diesen Schritt war die bereits bezahlte Galerie leer
    // (5c-Befund: „Noch keine Bilder generiert", galleryImgs=0). Das Lesen der
    // sessionStorage berührt keinen KI-Pfad → 0 verbrauchte Generierungen.
    const entries = readGallery();
    if (entries.length === 0) return;
    const restored: StudioImage[] = entries.map((entry) => ({
      id: entry.id,
      url: entry.url,
      prompt: entry.prompt,
      aspectRatio: entry.aspectRatio,
      createdAt: new Date(entry.createdAt),
      preview: entry.preview,
    }));
    imagesRef.current = restored;
    setImages(restored);
    setGeneratedCount(restored.length);
    setRestoredCount(restored.length);
  }, []);
  useEffect(() => {
    // Query-Param-Auswertung (additiv, bestehende Einstiege unverändert):
    // - fromStrategy=1: Strategie-Prefill-Flow (hat Vorrang, wenn Payload da ist)
    // - ?prompt=...: Deep-Link aus der TikTok-ResultView (studioPrompt)
    // - ?idea=...: bestehender Ideen-Einstieg
    // Phase 3.3c: KEIN Early-Return mehr — fehlt der (früher einmalig
    // konsumierte, jetzt nicht mehr zerstörend gelesene) Strategie-Payload,
    // fällt die Auflösung auf ?prompt=/?idea= zurück (reine, getestete Funktion).
    const resolved = resolveStudioPrefill(window.location.search, readStrategyPrefill());
    if (resolved.strategy) {
      const strategy = resolved.strategy;
      setStrategyPrefill(strategy);
      // Fail-closed: nur die Whitelist der Formate (sonst Studio-Default 2:3).
      setRatio(isImageAspectRatio(strategy.ratio) ? strategy.ratio : '2:3');
      // Schritt 3 (Punkt 5): Prompt + Bildidee + Text-Overlay + Plattform +
      // Produktidee + Markeninfo fließen jetzt in den GENERIERTEN Prompt ein —
      // vorher waren sie reine Anzeige-Chips.
      const brandInfo = strategy.brandInfo || formatStrategyBrandContext(getBrandProfile());
      setPrompt(
        composeStrategyStudioPrompt({ ...strategy, brandInfo }, {
          product: t.image_studio_prompt_line_product,
          concept: t.image_studio_prompt_line_concept,
          overlay: t.image_studio_prompt_line_overlay,
          platform: t.image_studio_prompt_line_platform,
          brand: t.image_studio_prompt_line_brand,
          // Schritt 4: Bildtext-/Typografie-Regeln + Negativ-Baustein.
          rules: studioPromptRules(t),
        }),
      );
      // Projektkontext (Punkt 5): Projekt automatisch vorauswählen.
      if (strategy.projectId) setSelectedProject(strategy.projectId);
    }
    setFromTikTok(resolved.fromTikTok);
    // Schritt 3: Format aus dem Deep-Link bzw. 9:16 für den TikTok-Einstieg.
    if (resolved.ratio) setRatio(resolved.ratio);
    if (resolved.prompt && !resolved.strategy) {
      // Schritt 4: auch der Deep-Link-/Ideen-Pfad bekommt die Text-im-Bild-
      // Regeln (Typografie + Negativ-Baustein) — kein ungeschützter Prompt.
      const rules = composeTextOverlayInstructions(
        { platform: resolved.fromTikTok ? 'TikTok' : '' },
        studioPromptRules(t),
      );
      setPrompt(rules.length ? `${resolved.prompt}\n\n${rules.join('\n')}` : resolved.prompt);
    }
  }, []);
  useEffect(() => { if (user?.id) getProjectsByUser(user.id).then(setProjects).catch(() => setProjects([])); }, [user?.id]);
  // Server-side beta-tracking (additive): Image Studio opened.
  useEffect(() => { track('image_studio_opened', user?.id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);
  // Elapsed-time display while the main generation runs. Starts on `loading`,
  // ticks every second, resets to 0 when generation finishes (loading → false).
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);
  // Phase 3.4 — neue Karte voranstellen und die Galerie auf IMAGE_GALLERY_MAX
  // begrenzen (Speicherlast der Daten-URL-Bilder auf Android).
  const addImage = (image: GeneratedImage) => {
    const next = capGallery<StudioImage>([image, ...imagesRef.current], IMAGE_GALLERY_MAX).items;
    imagesRef.current = next;
    setImages(next);
    setGeneratedCount((c) => c + 1);
    // Phase 5d (Fund 3) — die Galerie sofort in die sessionStorage spiegeln,
    // damit sie Zurück/Vorwärts und einen Reload übersteht. Asynchron, weil zu
    // große Originale vorher zu einer Vorschau verkleinert werden; ein Fehler
    // hier darf die gelungene Generierung nie kaputtmachen.
    void persistGallery(next).catch(() => { /* Persistenz ist Zusatznutzen */ });
  };
  // Phase 3.1 — ehrlicher Fehlertext: Timeout (Guard), Nutzer-Abbruch, sonst generisch.
  const errorText = errorKind === 'timeout'
    ? t.image_studio_error_timeout.replace('%s', String(IMAGE_CLIENT_TIMEOUT_MS / 1000))
    : errorKind === 'user'
      ? t.image_studio_error_aborted
      : t.image_studio_error;
  const generate = async (text = prompt, selectedRatio = ratio, referenceImageData?: string) => {
    if (!text.trim()) return;
    // Schritt 3 (Punkt 3): Referenz prüfen, harten Produkttreue-Baustein anhängen
    // und den Modus FESTHALTEN — „Variation" ohne Referenz gibt es nicht mehr.
    const reference = sanitizeReferenceImageData(referenceImageData);
    const finalPrompt = composePromptWithReferenceLock(
      text,
      t.image_studio_prompt_reference_lock,
      Boolean(reference),
    );
    setLoading(true); setError(false); setErrorKind(null); setUsageError(null);
    setLastRunMode(reference ? 'edit' : 'generate');
    // Admin-Analytics MVP Phase 1 (additive): image generation started/finished.
    const imageStart = Date.now();
    try { trackAnalytics('generation_started', { channel: 'image', status: 'started' }); } catch { /* never block */ }
    // Phase 3.1 — Timeout + Abbruch über die Guard (analog TikTok-Safeguards):
    // die Promise settelt IMMER (nach 120 s Timeout, bei „Abbrechen“ oder
    // regulär), deshalb endet der Ladezustand garantiert im finally — kein
    // unendlicher Skeleton mehr.
    setStreamPreview(null);
    // Option 1 (Bild-Latenz): Jeder Klick läuft über die SSE-Route — jedes
    // Zwischenbild ersetzt sofort die Vorschau. Ist die Route nicht erreichbar
    // (Umgebung ohne sie, HTML/404) UND kam kein Zwischenbild an, fällt
    // runStudioImage auf den bestehenden ServerFn zurück; kam schon eins an,
    // gibt es keinen zweiten Modell-Call.
    const guard = guardImageRun((signal) => runStudioImage({
      body: { prompt: finalPrompt, aspectRatio: selectedRatio, referenceImageData: reference },
      fallback: (s) => generateImageServer({ data: { prompt: finalPrompt, aspectRatio: selectedRatio, referenceImageData: reference }, signal: s }),
      onPartial: (partial) => setStreamPreview(partial.dataUrl),
      signal,
    }));
    runGuardRef.current = guard;
    try { const result = await guard.promise; addImage({ id: crypto.randomUUID(), url: result.url, prompt: finalPrompt, aspectRatio: selectedRatio, createdAt: new Date() }); track('image_generated', user?.id, { aspectRatio: selectedRatio, mode: reference ? 'edit' : 'generate' }); try { trackAnalytics('generation_finished', { channel: 'image', status: 'done', durationMs: Date.now() - imageStart }); } catch { /* never block */ } }
    catch (e) { const reason = guard.reason(); setErrorKind(reason ?? 'generic'); setUsageError(reason ? null : friendlyServerError(e)); setError(true); try { const cls = classifyGenerationError(e, reason); trackAnalytics('generation_finished', { channel: 'image', status: 'error', durationMs: Date.now() - imageStart, errorCategory: cls.category, errorCode: cls.code }); } catch { /* never block */ } } finally { runGuardRef.current = null; setLoading(false); setStreamPreview(null); }
  };
  // Per-card gallery action (Variation / Neu generieren): shows immediate
  // feedback on the card itself, keeps the original image, prepends the new
  // variant, and surfaces a readable per-card error instead of a generic banner.
  const runCardAction = async (image: GeneratedImage, action: 'variation' | 'regenerate') => {
    // 'regenerate' intentionally reproduces the EXACT original prompt. Only
    // 'variation' builds a new prompt: it keeps the original subject/style/
    // format text and appends a rotation-selected direction that explicitly
    // changes composition/perspective/lighting, so gpt-image-1 produces a
    // visibly different frame instead of an identical near-fold.
    const directionKey = variationDirectionKeys[variationCounter.current % variationDirectionKeys.length];
    const cardPrompt = (action === 'variation'
      ? `${image.prompt}. ${t.image_studio_prompt_variation.replace('%s', t[directionKey])}`
      : image.prompt).trim();
    // Schritt 3 (Punkt 3): Eine Karten-Variation variiert ein VORHANDENES Bild.
    // Genau dieses Bild (data-URL aus der Generierung bzw. der wiederhergestellten
    // Vorschau) geht jetzt als verbindliche Referenz mit — vorher wurde das Motiv
    // aus dem Prompt-Text neu erfunden. „Neu generieren" bleibt bewusst ohne
    // Referenz (es reproduziert den ursprünglichen Prompt).
    const reference = action === 'variation' ? sanitizeReferenceImageData(image.url) : undefined;
    const finalPrompt = composePromptWithReferenceLock(
      cardPrompt,
      t.image_studio_prompt_reference_lock,
      Boolean(reference),
    );
    if (finalPrompt) variationCounter.current += 1;
    if (!finalPrompt) return;
    setBusy({ id: image.id, action });
    setCardError(null);
    setLastRunMode(reference ? 'edit' : 'generate');
    // Admin-Analytics MVP Phase 1 (additive): card action started/finished.
    const cardStart = Date.now();
    try { trackAnalytics('generation_started', { channel: 'image', status: 'started' }); } catch { /* never block */ }
    // Phase 3.1 — auch Karten-Aktionen laufen über die Guard (kein Hänger).
    setStreamPreview(null);
    const guard = guardImageRun((signal) => runStudioImage({
      body: { prompt: finalPrompt, aspectRatio: image.aspectRatio, referenceImageData: reference },
      fallback: (s) => generateImageServer({ data: { prompt: finalPrompt, aspectRatio: image.aspectRatio, referenceImageData: reference }, signal: s }),
      // Karten-Aktionen haben keine eigene Vorschau-Karte (der Spinner sitzt am
      // Kartenknopf) — Partials werden nur gezählt, damit der Rückfall ehrlich bleibt.
      onPartial: () => { /* kein Vorschau-Element vorhanden */ },
      signal,
    }));
    runGuardRef.current = guard;
    try {
      const result = await guard.promise;
      addImage({ id: crypto.randomUUID(), url: result.url, prompt: finalPrompt, aspectRatio: image.aspectRatio, createdAt: new Date() });
      track('image_generated', user?.id, { aspectRatio: image.aspectRatio, action, mode: reference ? 'edit' : 'generate' });
      try { trackAnalytics('generation_finished', { channel: 'image', status: 'done', durationMs: Date.now() - cardStart }); } catch { /* never block */ }
    } catch (e) {
      const reason = guard.reason();
      setUsageError(reason ? null : friendlyServerError(e));
      setCardError({
        id: image.id,
        message: reason === 'timeout'
          ? t.image_studio_error_timeout.replace('%s', String(IMAGE_CLIENT_TIMEOUT_MS / 1000))
          : reason ? t.image_studio_error_aborted : t.image_studio_card_error,
      });
      try { const cls = classifyGenerationError(e, reason); trackAnalytics('generation_finished', { channel: 'image', status: 'error', durationMs: Date.now() - cardStart, errorCategory: cls.category, errorCode: cls.code }); } catch { /* never block */ }
    } finally {
      runGuardRef.current = null;
      setBusy(null);
      setStreamPreview(null);
    }
  };
  // Phase 8.2 — serverseitige Nutzer-Meldungen (Limit/Drossel/Sitzung) direkt
  // anzeigen; alle anderen Fehler weiterhin mit generischem Text.
  const friendlyServerError = (e: unknown): string | null => {
    const m = (e as { message?: string } | null)?.message;
    if (!m) return null;
    if (
      m.includes('Limit') || m.includes('warte') || m.includes('Sitzung') ||
      m.includes('Too many') || m.includes('session') || m.includes('monthly') ||
      // Schritt 3: Referenz-Fehler ehrlich anzeigen statt „Fehler bei der
      // Bildgenerierung" — sonst sucht der Nutzer den Fehler an der falschen Stelle.
      m.includes('Referenzbild')
    ) return m;
    return null;
  };
  const project = projects.find((p) => p.id === selectedProject);
  const strategyPrompts = project ? templates.map(([, , baseKey]) => `${t[baseKey]} ${project.productIdea}, ${t.image_studio_prompt_optimized_for} ${project.contentTypes.map((ct) => contentTypeLabel(t, ct)).join(', ')}.`) : [];
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ } };
  const download = async (image: GeneratedImage) => {
    try {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `growimo-${image.id}.png`;
      a.click();
      // Let the browser start the download before releasing the blob URL.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      setError(true);
    }
  };
  // Stabilisierung Schritt 3 (Punkt 3) — UPLOAD mit echtem Bildinhalt.
  // Vorher: `{ name, url: URL.createObjectURL(file) }` → keine Bildidentität,
  // die „Variation" war eine Neuerfindung aus dem Dateinamen. Jetzt wird der
  // Inhalt als data-URL gelesen (nur im State, nie in der sessionStorage) und
  // bei Bedarf für den Request verkleinert.
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const entry: UploadEntry = {
        name: file.name,
        url,
        dataUrl: null,
        mime: file.type || 'image/png',
        status: 'reading',
      };
      setUploads((prev) => [...prev, entry]);
      void readFileAsDataUrl(file)
        .then((raw) => shrinkReferenceImage(raw))
        .then((prepared) => {
          const usable = sanitizeReferenceImageData(prepared);
          setUploads((prev) =>
            prev.map((u) =>
              u.url === url
                ? { ...u, dataUrl: usable ?? null, status: usable ? 'ready' : 'failed' }
                : u,
            ),
          );
        })
        .catch(() => {
          setUploads((prev) =>
            prev.map((u) => (u.url === url ? { ...u, dataUrl: null, status: 'failed' } : u)),
          );
        });
    }
  };
  // Schritt 3 (Punkt 3): Der Upload-Variations-Knopf ist NUR mit echtem
  // Bildinhalt aktiv. Ohne brauchbare Referenz wird nichts als „Variation"
  // verkauft (kein stiller Text→Bild-Pfad) — der Grund steht am Knopf.
  const uploadVariationPrompt = (): string => {
    const directionKey = variationDirectionKeys[variationCounter.current % variationDirectionKeys.length];
    variationCounter.current += 1;
    return `${t.image_studio_prompt_upload_variation}: ${t[directionKey]}`;
  };
  // Schritt 3 (Punkt 5): vorhandenes Produktbild für die Strategie-Generierung —
  // Referenz aus dem Prefill, sonst das erste im Studio hochgeladene Produktbild.
  const strategyReference = pickStrategyReferenceImage(
    strategyPrefill?.referenceImage,
    uploads,
  );
  return <div className="mx-auto max-w-5xl space-y-8">
    <header><div className="mb-2 flex flex-wrap items-center gap-3"><Link to="/app" className="text-sm text-blue-600 hover:underline">← {t.nav_dashboard}</Link>{fromTikTok && <Link to="/app/tiktok" className="text-sm text-blue-600 hover:underline">← {t.image_studio_back_to_tiktok}</Link>}
      {/* Stabilisierung Schritt 4 (Punkt 6): kontextabhängiger Rückweg — nur
          wenn der Prefill die Herkunft kennt (Paket/Projekt). Reine Router-Links,
          kein window.location (bfcache-fest, kosten 0 Generierungen). */}
      {strategyPrefill?.source === 'package' && <Link to="/app/package" className="text-sm text-blue-600 hover:underline" data-testid="studio-back-package">{t.image_studio_back_to_package}</Link>}
      {strategyPrefill?.projectId && <Link to="/app/projects/$projectId" params={{ projectId: strategyPrefill.projectId }} className="text-sm text-blue-600 hover:underline" data-testid="studio-back-project">{t.image_studio_back_to_project}</Link>}</div><h1 className="text-3xl font-bold text-gray-900">{t.image_studio_page_title}</h1><p className="mt-2 text-gray-500">{t.image_studio_page_subtitle}</p></header>
    {strategyPrefill && <StrategyStamp t={t} prefill={strategyPrefill} />}
    <section className="rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white shadow-lg"><label className="mb-2 block text-sm font-semibold">{t.image_studio_prompt_label}</label><div className="flex flex-col gap-3 sm:flex-row"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.image_studio_prompt_placeholder} className="min-w-0 flex-1 rounded-xl border-0 px-4 py-3 text-gray-900 outline-none ring-2 ring-transparent focus:ring-white" /><button onClick={() => void generate(prompt, ratio, strategyReference)} disabled={loading || !prompt.trim()} className="rounded-xl bg-white px-6 py-3 font-bold text-blue-700 transition hover:bg-blue-50 disabled:opacity-60">{loading ? <span className="inline-block animate-spin">◌</span> : '✨'} {loading ? t.image_studio_generating : t.image_studio_generate_btn}</button>{loading && <button type="button" onClick={() => runGuardRef.current?.abort('user')} className="rounded-xl border border-white/70 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20">{t.image_studio_abort}</button>}</div><p className="mt-5 text-xs font-semibold uppercase tracking-wide text-blue-100">{t.image_studio_templates_label}</p><div className="mt-2 flex flex-wrap gap-2">{templates.map(([r, key, baseKey]) => <button key={r} onClick={() => { setRatio(r); setPrompt(`${t[baseKey]} ${prompt || t.image_studio_prompt_fallback_product}${t.image_studio_prompt_suffix}`); }} className="rounded-full bg-white/15 px-3 py-2 text-xs font-semibold transition hover:bg-white/30">{t[key]} </button>)}</div></section>
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-gray-900">{t.image_studio_from_strategy}</h2><select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="mt-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm"><option value="">{t.image_studio_select_project}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{strategyPrompts.length > 0 && <><p className="mt-4 text-sm font-semibold text-gray-700">{t.image_studio_prompts_generated}</p><div className="mt-2 flex flex-wrap gap-2">{strategyPrompts.map((p) => <button key={p} onClick={() => setPrompt(p)} className="rounded-full bg-blue-50 px-3 py-2 text-left text-xs text-blue-700 transition hover:bg-blue-100">{p}</button>)}</div></>}</section>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{usageError ?? errorText} <button onClick={() => void generate(prompt, ratio, strategyReference)} className="ml-3 font-bold underline">{t.analysis_retry}</button></div>}
    {(strategyReference || lastRunMode === 'edit') && <p data-testid="image-studio-reference-hint" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">{t.image_studio_reference_sent_hint}</p>}
    <section><h2 className="mb-4 text-xl font-bold text-gray-900">{t.image_studio_gallery_title}</h2>{restoredCount > 0 && <p data-testid="image-gallery-restored-hint" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">{t.image_studio_gallery_restored_hint.replace('%s', String(restoredCount))}</p>}{generatedCount > IMAGE_GALLERY_MAX && <p data-testid="image-gallery-cap-hint" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">{t.image_studio_gallery_cap_hint.replace('%s', String(IMAGE_GALLERY_MAX))}</p>}{images.length === 0 && !loading ? <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center text-sm text-gray-500">{t.image_studio_empty}</div> : <div className="grid grid-cols-1 gap-6 md:grid-cols-2">{loading && <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"><div className={`relative ${aspectClass(ratio)} bg-gray-100`}>{streamPreview ? <img data-testid="image-studio-stream-preview" src={streamPreview} alt={t.image_studio_streaming_refining} className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-gray-200" />}{streamPreview && <span data-testid="image-studio-stream-badge" className="absolute right-3 top-3 rounded-full bg-blue-600/90 px-3 py-1 text-xs font-bold text-white">{t.image_studio_streaming_preview_badge}</span>}</div><p className="px-4 py-4 text-sm font-semibold text-gray-500"><span>{t.image_studio_generating}</span> · {elapsed}s</p>{streamPreview && <p data-testid="image-studio-stream-hint" className="border-t border-blue-100 bg-blue-50 px-4 py-2.5 text-xs font-semibold text-blue-700">{t.image_studio_streaming_refining}</p>}</article>}{images.map((image) => <article key={image.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md"><div className={`relative ${aspectClass(image.aspectRatio)} bg-gray-100`}><img src={image.url} alt={image.prompt} className="h-full w-full object-cover" /><span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-gray-700">{image.aspectRatio}</span>{image.preview && <span data-testid="image-preview-badge" title={t.image_studio_gallery_preview_hint} className="absolute right-3 top-3 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-white">⚠ {t.image_studio_gallery_preview_badge}</span>}</div>{cardError?.id === image.id && <div className="border-t border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">{cardError.message}</div>}<div className="grid grid-cols-2 gap-2 p-4"><button onClick={() => download(image)} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200">⬇ {t.image_studio_download}</button><button onClick={() => void copy(image.prompt)} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200">📋 {t.image_studio_copy_prompt}</button><button onClick={() => void runCardAction(image, 'regenerate')} disabled={busy?.id === image.id} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200 disabled:opacity-60">{busy?.id === image.id && busy.action === 'regenerate' ? <span className="inline-block animate-spin">◌</span> : '🔄'} {busy?.id === image.id && busy.action === 'regenerate' ? t.image_studio_regenerate_generating : t.image_studio_regenerate}</button><button onClick={() => void runCardAction(image, 'variation')} disabled={busy?.id === image.id} className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200 disabled:opacity-60">{busy?.id === image.id && busy.action === 'variation' ? <span className="inline-block animate-spin">◌</span> : '✨'} {busy?.id === image.id && busy.action === 'variation' ? t.image_studio_variation_generating : t.image_studio_variation}</button></div></article>)}</div>}</section>
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold text-gray-900">{t.image_studio_upload_title}</h2><label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-8 text-center transition hover:bg-blue-50"><span className="text-3xl">⬆️</span><span className="mt-2 text-sm font-semibold text-blue-700">{t.image_studio_upload_dropzone}</span><input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} /></label>{uploads.length > 0 && <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{uploads.map((file) => <div key={file.url} className="overflow-hidden rounded-xl border" data-testid="upload-card"><img src={file.url} className="aspect-square w-full object-cover" alt={file.name} /><p className="truncate p-2 text-xs text-gray-600">{file.name}</p>{file.status === 'ready' ? <><button type="button" data-testid="upload-variation-btn" disabled={loading} onClick={() => void generate(uploadVariationPrompt(), '1:1', file.dataUrl ?? undefined)} className="m-2 rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60">✨ {t.image_studio_upload_variation_btn}</button><p className="mx-2 mb-2 text-[10px] leading-snug text-emerald-700">{t.image_studio_upload_reference_active}</p></> : <><button type="button" data-testid="upload-variation-btn" disabled className="m-2 cursor-not-allowed rounded-lg bg-gray-300 px-2 py-1 text-xs font-semibold text-white">✨ {t.image_studio_variation}</button><p className="mx-2 mb-2 text-[10px] leading-snug text-gray-500" data-testid="upload-no-reference">{file.status === 'reading' ? t.image_studio_upload_reading : t.image_studio_upload_reference_missing}</p></>}</div>)}</div>}</section>
  </div>;
}

import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from '~/i18n';
import { saveStrategyPrefill, type StrategyImagePayload } from '~/lib/strategy-image';
import { rememberContext, type AppContextSource } from '~/lib/app-context';
import { getBrandProfile, isBrandProfileEnabled } from '~/store/brand';
import { formatStrategyBrandContext } from '~/lib/studio-deeplink';

/**
 * Stabilisierung Schritt 4 (Punkt 6) — wiederverwendbare „Weiter mit …“-Aktionen.
 *
 * Zweck: statt den Nutzer zurück ins Dashboard zu schicken, führt EIN Klick in
 * den nächsten sinnvollen Schritt — mit mitgenommenem Kontext.
 *
 * Bewusst NICHT enthalten (kein Doppelbau, Owner-Vorgabe „bestehende Features
 * schützen“): „✓ Zum Projekt“/„Projekt ansehen“ (new-project/package haben das),
 * „🎨 Bild jetzt erstellen“ im Paket-Flow (Schritt 3, `package-create-image`),
 * A/B-Varianten (`VariantPicker`) und „⚡ Verbessern“ (`ScoreCard`) — die sitzen
 * dort bereits bzw. werden vom jeweiligen Aufrufer mitgeliefert.
 *
 * Enthalten sind genau die Aktionen, die vorher FEHLTEN:
 *   - „🎨 Bild erstellen“      → Strategie-Prefill schreiben + Studio öffnen
 *   - „🎵 TikTok-Konzept …“    → TikTok-Werkstatt MIT Projektkontext
 *   - „📂 Im Projekt öffnen“   → Projekt-Detail (Inhaltsbibliothek)
 *
 * Kontextregel: Jede Aktion schreibt vorher den Workflow-Kontext
 * (`lib/app-context.ts`, additiv) — Projekt, Produktidee, Herkunft, Markenstand.
 * Bei fehlender Produktidee wird sie aus dem Projektbezug des Payloads geholt;
 * ganz ohne Kontext wird nichts geschrieben.
 */
export interface NextActionsProps {
  /** Bezugsprojekt. Ohne Projekt-ID entfallen Projekt-/TikTok-Aktionen. */
  projectId?: string;
  /** Produktidee für den Kontext-Transport (optional). */
  productIdea?: string;
  /** Wenn gesetzt (und ein Prompt extrahierbar war): „🎨 Bild erstellen“. */
  imagePayload?: StrategyImagePayload | null;
  /** „🎵 TikTok-Konzept aus diesem Projekt“ anbieten. */
  tiktok?: boolean;
  /** „📂 Im Projekt öffnen“ anbieten. */
  openProject?: boolean;
  /** Kleine Überschrift „Weiter mit …“ (Standard: an). */
  heading?: boolean;
  /** Zusätzliche CSS-Klassen (z. B. Abstand). */
  className?: string;
  /** Test-Hook für die E2E/Playwright-Prüfungen. */
  testId?: string;
}

/**
 * Baut den Bild-Prefill mit vollem Kontext: bereits vom Extraktor mitgegebene
 * Felder gewinnen, fehlende werden aus Projekt/Produktidee/Markenprofil ergänzt.
 * Reine Funktion (testbar), greift nur lesend auf das Markenprofil zu.
 */
export function enrichImagePayload(
  payload: StrategyImagePayload,
  projectId?: string,
  productIdea?: string,
): StrategyImagePayload {
  const profile = getBrandProfile();
  return {
    ...payload,
    projectId: payload.projectId || projectId || '',
    productIdea: payload.productIdea || productIdea || '',
    brandInfo: payload.brandInfo || formatStrategyBrandContext(profile),
  };
}

export function NextActions({
  projectId,
  productIdea,
  imagePayload = null,
  tiktok = false,
  openProject = false,
  heading = true,
  className = '',
  testId = 'next-actions',
}: NextActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const project = (projectId ?? '').trim();
  const showImage = Boolean(imagePayload);
  const showTikTok = Boolean(tiktok && project);
  const showProject = Boolean(openProject && project);
  if (!showImage && !showTikTok && !showProject) return null;

  const source = (imagePayload?.source ?? 'strategy') as AppContextSource;
  const context = {
    projectId: imagePayload?.projectId || project || undefined,
    productIdea: imagePayload?.productIdea || productIdea?.trim() || undefined,
    source,
    brandEnabled: isBrandProfileEnabled(),
  };

  const buttonBase =
    'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition-all';
  const primary = `${buttonBase} border-transparent bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:opacity-95 hover:shadow-md`;
  const secondary = `${buttonBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`;

  const openImageStudio = () => {
    if (!imagePayload) return;
    const payload = enrichImagePayload(imagePayload, project, productIdea);
    rememberContext(context);
    saveStrategyPrefill(payload);
    void navigate({ to: '/app/image-studio', search: { fromStrategy: '1' } });
  };

  return (
    <section
      className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm ${className}`}
      data-testid={testId}
    >
      {heading && (
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">
          {t.next_actions_title}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {showImage && (
          <button
            type="button"
            onClick={openImageStudio}
            className={primary}
            data-testid={`${testId}-image`}
          >
            {t.image_studio_create_image_now}
          </button>
        )}
        {showTikTok && (
          <Link
            to="/app/tiktok"
            onClick={() =>
              rememberContext({
                projectId: project,
                productIdea: productIdea?.trim() || undefined,
                source: 'project',
                brandEnabled: isBrandProfileEnabled(),
              })
            }
            className={secondary}
            data-testid={`${testId}-tiktok`}
          >
            {t.next_actions_tiktok}
          </Link>
        )}
        {showProject && (
          <Link
            to="/app/projects/$projectId"
            params={{ projectId: project }}
            className={secondary}
            data-testid={`${testId}-project`}
          >
            {t.next_actions_open_project}
          </Link>
        )}
      </div>
      {(showTikTok || showImage) && (
        <p className="mt-2 text-xs text-gray-500">{t.next_actions_context_hint}</p>
      )}
    </section>
  );
}

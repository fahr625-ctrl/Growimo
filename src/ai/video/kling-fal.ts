/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Kling-Adapter als STRUKTUR, hart abgeschaltet.
 *
 * WARUM HIER NICHTS PASSIERT: Der Datenschutzpunkt ist nicht geklärt (Kling AI
 * Pte. Ltd., Singapur, kein fal-Sub-Prozessor, keine EU-Verarbeitung —
 * `RECHTE-UND-WIRTSCHAFT.md`). Deshalb ist in diesem Auftrag JEDER
 * fal-/Kling-Aufruf verboten, auch ein Testaufruf mit Miniatur-Prompt.
 *
 * DREI TORE, alle VOR dem ersten Netz-Zugriff:
 *   1. `VIDEO_PROVIDER_ENABLED === 'true'`   (Feature-Flag, Default aus)
 *   2. `FAL_KEY` gesetzt und nicht leer      (ohne Key kein Aufruf)
 *   3. `VIDEO_PROVIDER_ALLOW_NETWORK === 'true'` (zweites, bewusst redundantes
 *      Tor — ein versehentlich gesetztes Flag allein reicht nicht)
 *
 * Fällt eines, wirft der Adapter `VideoProviderDisabledError`. Es gibt KEINEN
 * stillen Fallback auf einen anderen (teuren) Anbieter (§2.1 fail-closed).
 */

import {
  type VideoClipRequest,
  type VideoClipResult,
  type VideoJobStatus,
  type VideoProvider,
  type VideoProviderCaps,
  VideoError,
  VideoProviderDisabledError,
} from './types';

export const VIDEO_PROVIDER_ENABLED_ENV = 'VIDEO_PROVIDER_ENABLED';
export const VIDEO_PROVIDER_ALLOW_NETWORK_ENV = 'VIDEO_PROVIDER_ALLOW_NETWORK';
export const FAL_KEY_ENV = 'FAL_KEY';

/** Caps nach den belegten fal-Angaben — „unbekannt" wird bewusst als false geführt. */
const KLING_FAL_CAPS: VideoProviderCaps = {
  maxClipSeconds: 10, // Owner-Grenze 10 (Anbieter könnte 15)
  minClipSeconds: 3,
  // fal: `last_frame` NICHT belegt (§2.2) ⇒ false. Die Registry verweigert damit
  // jede Anfrage MIT Endbild, statt still ein anderes Video zu liefern.
  supportsEndImage: false,
  supportsElement: false,
  supportsMultiShot: false,
  acceptsBase64Image: false, // fal-Feldnamen nicht belegt
  reportsBilling: false, // billing[] nur bei der Direkt-API belegt
};

export interface KlingFalOptions {
  /** Erlaubt ein Test den Aufruf mit explizit gesetzten Werten. */
  env?: Record<string, string | undefined>;
  /** Nur für einen späteren, ausdrücklich freigegebenen Prüfaufruf. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Sind alle drei Tore offen? (Default: nein — fail-closed.) */
export function klingFalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const key = env[FAL_KEY_ENV];
  return (
    env[VIDEO_PROVIDER_ENABLED_ENV] === 'true' &&
    typeof key === 'string' &&
    key.trim().length > 0 &&
    env[VIDEO_PROVIDER_ALLOW_NETWORK_ENV] === 'true'
  );
}

/** Welches Tor fehlt? (nur für Logs/Diagnose — enthält KEINE Secret-Werte.) */
export function klingFalDisabledReason(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env[VIDEO_PROVIDER_ENABLED_ENV] !== 'true') return `${VIDEO_PROVIDER_ENABLED_ENV} ist nicht 'true'`;
  if (!env[FAL_KEY_ENV] || env[FAL_KEY_ENV]!.trim().length === 0) return `${FAL_KEY_ENV} ist nicht gesetzt`;
  if (env[VIDEO_PROVIDER_ALLOW_NETWORK_ENV] !== 'true') return `${VIDEO_PROVIDER_ALLOW_NETWORK_ENV} ist nicht 'true'`;
  return null;
}

/**
 * Struktur-Adapter für Kling über fal.ai. In diesem Auftrag wird er NIE
 * aufgerufen; jeder Pfad endet in `assertEnabled()`.
 */
export function createKlingFalProvider(options: KlingFalOptions = {}): VideoProvider {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? 'https://queue.fal.run';

  const assertEnabled = (): void => {
    const reason = klingFalDisabledReason(env);
    if (reason) {
      throw new VideoProviderDisabledError(
        `Video-Anbieter 'kling-fal' ist abgeschaltet (${reason}). Es wurde kein Netz-Aufruf gemacht.`,
      );
    }
  };

  return {
    id: 'kling-fal',
    model: 'kling-video/v2.5-turbo/pro/image-to-video',
    caps: KLING_FAL_CAPS,

    async submit(req: VideoClipRequest): Promise<{ providerJobId: string; model: string }> {
      assertEnabled();
      if (!fetchImpl) throw new VideoError('no_fetch', 'Kein fetch verfügbar');
      // Ab hier wäre ein echter Aufruf — in diesem Auftrag unerreichbar, weil
      // assertEnabled() ohne alle drei Tore bereits geworfen hat. Die Struktur
      // ist bewusst nur ein Gerüst: die fal-Feldnamen für Start-/Endbild sind
      // nicht belegt (§2.2) und werden NICHT geraten.
      const response = await fetchImpl(`${baseUrl}/kling-video/v2.5-turbo/pro/image-to-video`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: req.prompt,
          duration: String(req.durationSeconds),
          external_task_id: req.externalTaskId,
          multi_shot: false, // §2.5 Falle 1: IMMER explizit
        }),
      });
      if (!response.ok) throw new VideoError('provider_http_error', `Anbieter antwortete ${response.status}`);
      const body = (await response.json()) as { request_id?: string };
      if (!body.request_id) throw new VideoError('provider_bad_response', 'Anbieter lieferte keine request_id');
      return { providerJobId: body.request_id, model: 'kling-video/v2.5-turbo/pro/image-to-video' };
    },

    async status(providerJobId: string): Promise<VideoJobStatus> {
      assertEnabled();
      if (!fetchImpl) throw new VideoError('no_fetch', 'Kein fetch verfügbar');
      const response = await fetchImpl(`${baseUrl}/requests/${providerJobId}/status`, { method: 'GET' });
      if (!response.ok) throw new VideoError('provider_http_error', `Status-Abfrage ${response.status}`);
      const body = (await response.json()) as { status?: string };
      switch (body.status) {
        case 'IN_QUEUE':
          return { state: 'submitted' };
        case 'IN_PROGRESS':
          return { state: 'processing' };
        case 'COMPLETED':
          return { state: 'succeeded' };
        default:
          return { state: 'failed', errorCode: 'provider_failed' };
      }
    },

    async fetchResult(providerJobId: string): Promise<VideoClipResult> {
      assertEnabled();
      if (!fetchImpl) throw new VideoError('no_fetch', 'Kein fetch verfügbar');
      const response = await fetchImpl(`${baseUrl}/requests/${providerJobId}`, { method: 'GET' });
      if (!response.ok) throw new VideoError('provider_http_error', `Ergebnis-Abruf ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { bytes, contentType: response.headers.get('content-type') ?? 'video/mp4' };
    },
  };
}

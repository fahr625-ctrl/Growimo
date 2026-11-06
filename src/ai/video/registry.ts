/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Provider-Registry (fail-closed).
 *
 * §2.1: Unbekannte ID ⇒ Fehler, NIEMALS ein stiller Default auf einen teuren
 * Anbieter. Zusätzlich prüft die Registry die `caps` gegen die Anfrage: wer ein
 * Endbild an einen Anbieter schickt, der es nicht belegt kann, bekommt VOR dem
 * Aufruf einen Fehler — nicht stillschweigend ein anderes Video.
 *
 * Kein Netz, keine Zeit, keine DB — vollständig offline testbar.
 */

import { FakeVideoProvider, type FakeVideoProviderOptions } from './fake-provider';
import { createKlingFalProvider, klingFalEnabled, type KlingFalOptions } from './kling-fal';
import {
  type VideoClipRequest,
  type VideoProvider,
  type VideoProviderId,
  InvalidVideoRequestError,
  UnknownVideoProviderError,
  VideoCapabilityError,
} from './types';

export interface ResolveVideoProviderOptions {
  env?: Record<string, string | undefined>;
  fake?: FakeVideoProviderOptions;
  kling?: KlingFalOptions;
}

/** Alle IDs, die die Registry kennt (Whitelist, fail-closed). */
export const KNOWN_VIDEO_PROVIDER_IDS: readonly VideoProviderId[] = [
  'fake',
  'kling-fal',
  'kling-direct',
  'minimax-fal',
];

/**
 * Löst eine Anbieter-ID auf. Wirft bei unbekannter ID.
 *
 * `fake` ist der einzige Anbieter, der in dieser Runde tatsächlich etwas tut.
 * `kling-fal` liefert einen Adapter, dessen erster Aufruf ohne alle drei Tore
 * (Flag + Key + Netz-Freigabe) in `VideoProviderDisabledError` endet.
 * `kling-direct`/`minimax-fal` sind bewusst NICHT implementiert: sie würden
 * einen zweiten Vertrag und einen zweiten Key voraussetzen (§2.3).
 */
export function resolveVideoProvider(
  id: string,
  options: ResolveVideoProviderOptions = {},
): VideoProvider {
  if (!(KNOWN_VIDEO_PROVIDER_IDS as readonly string[]).includes(id)) {
    throw new UnknownVideoProviderError(String(id));
  }
  switch (id as VideoProviderId) {
    case 'fake':
      return new FakeVideoProvider(options.fake);
    case 'kling-fal':
      return createKlingFalProvider({ env: options.env ?? process.env, ...options.kling });
    default:
      // Bekannte ID, aber (noch) kein Adapter — kein stiller Ersatz.
      throw new UnknownVideoProviderError(`${id} (Adapter nicht implementiert)`);
  }
}

/** Ist der Anbieter in dieser Umgebung benutzbar? (nur Auskunft, kein Aufruf) */
export function isVideoProviderUsable(
  id: VideoProviderId,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (id === 'fake') return true;
  if (id === 'kling-fal') return klingFalEnabled(env);
  return false;
}

/**
 * Prüft eine Clip-Anfrage gegen Vertrag und Fähigkeiten des Anbieters.
 * Wirft, statt still etwas anderes zu tun.
 */
export function validateClipRequest(provider: VideoProvider, req: VideoClipRequest): void {
  if (!req || typeof req !== 'object') {
    throw new InvalidVideoRequestError('Anfrage fehlt');
  }
  if (typeof req.prompt !== 'string' || req.prompt.trim().length === 0) {
    throw new InvalidVideoRequestError('Prompt ist leer');
  }
  if (!Number.isInteger(req.durationSeconds)) {
    throw new InvalidVideoRequestError(`Dauer ist nicht ganzzahlig: ${req.durationSeconds}`);
  }
  if (req.durationSeconds < provider.caps.minClipSeconds || req.durationSeconds > provider.caps.maxClipSeconds) {
    throw new InvalidVideoRequestError(
      `Dauer ${req.durationSeconds}s liegt außerhalb von ${provider.caps.minClipSeconds}..${provider.caps.maxClipSeconds}s`,
    );
  }
  if (req.resolution !== '720p') {
    throw new InvalidVideoRequestError(`Auflösung ${String(req.resolution)} ist nicht freigegeben (nur 720p)`);
  }
  if (req.audio !== false) {
    throw new InvalidVideoRequestError('audio muss false sein (immer stumm)');
  }
  // §2.5 Falle 1: multi_shot ist bei Kling standardmäßig TRUE — wir setzen es
  // immer explizit. Ein fehlendes Feld ist deshalb ein Fehler, kein Default.
  if (req.multiShot !== false) {
    throw new InvalidVideoRequestError('multiShot muss explizit false sein');
  }
  if (typeof req.externalTaskId !== 'string' || req.externalTaskId.trim().length === 0) {
    throw new InvalidVideoRequestError('externalTaskId fehlt (Idempotenz, §4.3)');
  }
  if (req.startImage) {
    if (!provider.caps.acceptsBase64Image) {
      throw new VideoCapabilityError(`Anbieter '${provider.id}' nimmt kein Base64-Bild an`);
    }
    if (!req.startImage.base64) {
      throw new InvalidVideoRequestError('startImage ohne Inhalt');
    }
    if (req.startImage.mime !== 'image/jpeg' && req.startImage.mime !== 'image/png') {
      throw new InvalidVideoRequestError(`startImage.mime nicht unterstützt: ${String(req.startImage.mime)}`);
    }
  }
  if (req.endImage) {
    if (!provider.caps.supportsEndImage) {
      throw new VideoCapabilityError(
        `Anbieter '${provider.id}' kann kein Endbild (nicht belegt) — Anfrage wird VOR dem Aufruf verweigert`,
      );
    }
    if (!provider.caps.acceptsBase64Image) {
      throw new VideoCapabilityError(`Anbieter '${provider.id}' nimmt kein Base64-Bild an`);
    }
  }
  if (req.elementIds && req.elementIds.length > 0) {
    if (req.elementIds.length > 3) {
      throw new InvalidVideoRequestError('Höchstens 3 Elemente (Figurenkonsistenz)');
    }
    if (!provider.caps.supportsElement) {
      throw new VideoCapabilityError(`Anbieter '${provider.id}' unterstützt keine Elemente`);
    }
  }
}

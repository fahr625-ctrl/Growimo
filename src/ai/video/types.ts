/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Anbieter-UNABHÄNGIGE Schnittstelle.
 *
 * Grundlage: `tiktok-video-2026-11-05/UMSETZUNGSPLAN.md` §2.1 (Schnittstelle),
 * §2.4 (Fehler/Retries), §2.5 (multi_shot/aspect_ratio-Fallen).
 *
 * Diese Datei enthält NUR Typen und Fehlerklassen — keinen Netzwerkcode, keine
 * Zeit, keine DB. Sie ist damit vollständig ohne Netz testbar.
 *
 * WICHTIG (Auftrag 2026-11-06): In dieser Runde gibt es KEINEN echten
 * Anbieter-Aufruf. Der Kling-Adapter existiert nur als Struktur hinter einem
 * Flag und ist ohne gesetzten API-Key hart abgeschaltet (§`kling-fal.ts`).
 */

/** Bekannte Anbieter-IDs. Bewusst eine geschlossene Liste (fail-closed). */
export type VideoProviderId = 'fake' | 'kling-fal' | 'kling-direct' | 'minimax-fal';

/** Auflösungen, die die App anfordern darf. Stufe 1 ist fest 720p (§Owner). */
export type VideoResolution = '720p';

/** Ein Referenzbild (Start-/Endbild). Base64, kein URL-Feld — §2.1. */
export interface VideoReferenceImage {
  base64: string;
  mime: 'image/jpeg' | 'image/png';
}

/** Eine Clip-Anfrage — genau ein Anbieter-Aufruf. */
export interface VideoClipRequest {
  /** §5.6: STIL + Szenentext(e) + KONSISTENZ, hart auf 2400 Zeichen gekappt. */
  prompt: string;
  /** 3..10 (Owner-Grenze 10; der Anbieter könnte 15). */
  durationSeconds: number;
  resolution: VideoResolution;
  /** Immer stumm (Owner-Entscheidung: keine Pflicht-Sprachausgabe). */
  audio: false;
  /** §6.1: das Startbild bestimmt das Format (9:16 = 720x1280). */
  startImage?: VideoReferenceImage;
  /** §6.3: letzter Frame von Clip n als erster Frame von Clip n+1. */
  endImage?: VideoReferenceImage;
  /** Figurenkonsistenz (nur Direkt-API belegt) — max. 3. */
  elementIds?: string[];
  /** §2.5 Falle 1: IMMER explizit setzen. Kling defaultet auf true. */
  multiShot: false;
  /** §4.3: unsere Clip-UUID — Anbieter-Idempotenz. */
  externalTaskId: string;
}

/** Was ein Anbieter können muss bzw. können darf (fail-closed geprüft). */
export interface VideoProviderCaps {
  /** Längster Clip in einem Aufruf (Kling: 15). */
  maxClipSeconds: number;
  /** Kürzester Clip (Kling-Enum beginnt bei 3). */
  minClipSeconds: number;
  supportsEndImage: boolean;
  supportsElement: boolean;
  supportsMultiShot: boolean;
  acceptsBase64Image: boolean;
  /** Kann der Anbieter echte Kosten pro Auftrag melden? (§10.3) */
  reportsBilling: boolean;
}

/** Anbieter-Zustand, auf unsere drei Werte normalisiert (§4.2). */
export type VideoProviderState = 'submitted' | 'processing' | 'succeeded' | 'failed';

export interface VideoJobStatus {
  state: VideoProviderState;
  /** Nur wenn der Anbieter ihn wirklich liefert — nie geschätzt (§4.2). */
  progress?: number;
  /** Normalisierter Fehlercode, KEINE Rohantwort. */
  errorCode?: string;
}

/** Ergebnis-Download eines fertigen Clips. */
export interface VideoClipResult {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Die Anbieter-Schnittstelle (§2.1). `submit → status → fetchResult`.
 * Bewusst KEIN Event/Callback/Webhook in Stufe 1 (§4.1: der Client treibt).
 */
export interface VideoProvider {
  readonly id: VideoProviderId;
  readonly model: string;
  readonly caps: VideoProviderCaps;
  submit(req: VideoClipRequest): Promise<{ providerJobId: string; model: string }>;
  status(providerJobId: string): Promise<VideoJobStatus>;
  fetchResult(providerJobId: string): Promise<VideoClipResult>;
  cancel?(providerJobId: string): Promise<void>;
}

/** Basisklasse aller Video-Fehler: trägt einen stabilen, übersetzbaren Code. */
export class VideoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VideoError';
    this.code = code;
  }
}

/**
 * Der Anbieter ist abgeschaltet (Flag aus oder Key fehlt).
 * Wird VOR jedem Netzzugriff geworfen — der Aufruf endet hier, es gibt keinen
 * Fallback auf einen anderen (teuren) Anbieter (§2.1 Registry, fail-closed).
 */
export class VideoProviderDisabledError extends VideoError {
  constructor(message: string) {
    super('provider_disabled', message);
    this.name = 'VideoProviderDisabledError';
  }
}

/** Unbekannte Anbieter-ID — niemals stiller Default (§2.1). */
export class UnknownVideoProviderError extends VideoError {
  constructor(id: string) {
    super('unknown_provider', `Unbekannter Video-Anbieter: ${id}`);
    this.name = 'UnknownVideoProviderError';
  }
}

/** Die Anfrage verlangt mehr, als der Anbieter belegt kann (§2.1 caps-Prüfung). */
export class VideoCapabilityError extends VideoError {
  constructor(message: string) {
    super('capability_unsupported', message);
    this.name = 'VideoCapabilityError';
  }
}

/** Ungültige Clip-Anfrage (Dauer außerhalb der Grenzen, Prompt leer …). */
export class InvalidVideoRequestError extends VideoError {
  constructor(message: string) {
    super('invalid_request', message);
    this.name = 'InvalidVideoRequestError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Kampagne: Typen, Grenzen und Prüfregeln (rein, ohne DB/React)
// ─────────────────────────────────────────────────────────────────────────────
// Eine Kampagne trägt die GEMEINSAMEN Produktangaben einmal und speist daraus
// beide Kanäle. „Nur Etsy" braucht kein Foto, „Nur Pinterest" braucht kein Etsy.
// Nichts wird gebucht: Speichern kostet keine Einheit (keine KI im Spiel).
// ─────────────────────────────────────────────────────────────────────────────

import type { PinDraft } from './pin-drafts';
import type { EtsyDraft } from './etsy-draft';

export type CampaignOption = 'pinterest' | 'etsy' | 'both';

export const CAMPAIGN_OPTIONS: CampaignOption[] = ['pinterest', 'etsy', 'both'];

export const CAMPAIGN_LIMITS = {
  nameMax: 80,
  productMax: 600,
  audienceMax: 200,
  messageMax: 300,
  targetUrlMax: 500,
  /** Upload-Grenze vor der serverseitigen Verkleinerung. */
  photoMaxBytes: 8 * 1024 * 1024,
  /** Zielmaß des gespeicherten Fotos (Pin-Format). */
  photoMaxWidth: 1000,
  photoMaxHeight: 1500,
} as const;

export interface CampaignDraft {
  /** null/undefined ⇒ neue Kampagne anlegen. */
  id?: string | null;
  name: string;
  option: CampaignOption;
  product: string;
  audience: string;
  message: string;
  targetUrl: string;
  /** Originalfoto als Data-URL (nur bei Pinterest/Beides). */
  photoDataUrl?: string | null;
  brandApplied?: boolean;
  /** Bis zu fünf Pin-Entwürfe (nur bei Pinterest/Beides). */
  pins?: PinDraft[] | null;
  /** Ein Etsy-Listing-Entwurf (nur bei Etsy/Beides). */
  etsy?: EtsyDraft | null;
}

/** Braucht diese Option ein Foto? (Nur Etsy: nein.) */
export function optionNeedsPhoto(option: CampaignOption): boolean {
  return option === 'pinterest' || option === 'both';
}

/** Enthält diese Option einen Etsy-Teil? */
export function optionIncludesEtsy(option: CampaignOption): boolean {
  return option === 'etsy' || option === 'both';
}

export function isCampaignOption(v: unknown): v is CampaignOption {
  return v === 'pinterest' || v === 'etsy' || v === 'both';
}

export interface ParsedDataUrl {
  mime: string;
  base64: string;
  bytes: number;
}

/** Data-URL zerlegen (nur base64-Bilder, fail-closed). */
export function parseImageDataUrl(input: string | null | undefined): ParsedDataUrl | null {
  if (!input || typeof input !== 'string') return null;
  const match = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(input.trim());
  if (!match) return null;
  const base64 = match[3].replace(/\s+/g, '');
  const bytes = Math.floor((base64.length * 3) / 4);
  return { mime: match[1], base64, bytes };
}

/** Ziel-Link ist freiwillig, muss aber wenn angegeben http(s) sein. */
export function isValidTargetUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface CampaignValidation {
  ok: boolean;
  /** Fehler-Codes (i18n-Schlüssel `kampagne_err_<code>`). */
  errors: string[];
}

/**
 * Prüft einen Entwurf fail-closed. Gibt Fehler-Codes zurück, keine Texte —
 * die Oberfläche übersetzt sie, damit DE/EN nie auseinanderlaufen.
 */
export function validateCampaignDraft(draft: Partial<CampaignDraft> | null | undefined): CampaignValidation {
  const errors: string[] = [];
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['payload'] };

  const option = draft.option;
  if (!isCampaignOption(option)) errors.push('option');

  const product = (draft.product ?? '').trim();
  if (!product) errors.push('product_required');
  if (product.length > CAMPAIGN_LIMITS.productMax) errors.push('product_too_long');

  if ((draft.name ?? '').trim().length > CAMPAIGN_LIMITS.nameMax) errors.push('name_too_long');
  if ((draft.audience ?? '').trim().length > CAMPAIGN_LIMITS.audienceMax) errors.push('audience_too_long');
  if ((draft.message ?? '').trim().length > CAMPAIGN_LIMITS.messageMax) errors.push('message_too_long');

  const url = (draft.targetUrl ?? '').trim();
  if (url.length > CAMPAIGN_LIMITS.targetUrlMax) errors.push('url_too_long');
  if (!isValidTargetUrl(url)) errors.push('url_invalid');

  if (isCampaignOption(option) && optionNeedsPhoto(option)) {
    const photo = draft.photoDataUrl ?? null;
    if (!photo) {
      errors.push('photo_required');
    } else {
      const parsed = parseImageDataUrl(photo);
      if (!parsed) errors.push('photo_invalid');
      else if (parsed.bytes > CAMPAIGN_LIMITS.photoMaxBytes) errors.push('photo_too_large');
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Anzeigename: eigener Name, sonst aus dem Produkt abgeleitet (max. 80 Zeichen). */
export function deriveCampaignName(draft: Partial<CampaignDraft>): string {
  const explicit = (draft.name ?? '').trim();
  if (explicit) return explicit.slice(0, CAMPAIGN_LIMITS.nameMax);
  const product = (draft.product ?? '').trim().replace(/\s+/g, ' ');
  const base = product || 'Kampagne';
  return base.slice(0, CAMPAIGN_LIMITS.nameMax);
}

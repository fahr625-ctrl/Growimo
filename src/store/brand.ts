// ── Brand Profile Store ─────────────────────────────────────────────────────────
// In-memory store with localStorage persistence for brand profile.
// The brand context is automatically injected into every new strategy generation.

export interface BrandProfile {
  brandName: string;
  // NEU: Website / Online-Präsenz des Unternehmens (optional)
  website: string;
  tagline: string;
  tone: string;
  targetAudience: string;
  uniqueSellingPoint: string;
  // NEU: freie Beschreibung "Was bietest/verkaufst du?" — wichtigste Produkte/Funktionen/Leistungen
  offerings: string;
  // NEU: Hauptziel — Reichweite / Follower / Leads / Verkäufe / Bekanntheit
  mainGoal: string;
  // NEU: aktueller Status oder Herausforderung, z. B. "Beta gestartet, aber kaum Tester"
  statusChallenge: string;
  brandColors: string;
  competitors: string;
  products: string[];
  avoidTopics: string;
  // NEU: Dinge, die Growimo NIEMALS behaupten darf (optional)
  neverClaim: string;
  brandVoice: string;
  lastUpdated: string; // ISO date
}

const STORAGE_KEY = 'growimo_brand_profile';

function parseProducts(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getBrandProfile(): BrandProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrandProfile;
    // Backward-Kompatibilität: aus alten Profilen fehlende neue Felder ergänzen.
    return normalizeBrandProfile(parsed);
  } catch {
    return null;
  }
}

/** Ergänzt fehlende Felder mit leeren Defaults, damit alte Profile weiterladen. */
export function normalizeBrandProfile(profile: Partial<BrandProfile>): BrandProfile {
  return {
    brandName: (profile as BrandProfile).brandName ?? '',
    website: profile.website ?? '',
    tagline: profile.tagline ?? '',
    tone: profile.tone ?? '',
    targetAudience: profile.targetAudience ?? '',
    uniqueSellingPoint: profile.uniqueSellingPoint ?? '',
    offerings: profile.offerings ?? '',
    mainGoal: profile.mainGoal ?? '',
    statusChallenge: profile.statusChallenge ?? '',
    brandColors: profile.brandColors ?? '',
    competitors: profile.competitors ?? '',
    products: Array.isArray(profile.products) ? profile.products : [],
    avoidTopics: profile.avoidTopics ?? '',
    neverClaim: profile.neverClaim ?? '',
    brandVoice: profile.brandVoice ?? '',
    lastUpdated: (profile as BrandProfile).lastUpdated ?? '',
  };
}

/**
 * Prüft, ob ein Markenprofil "vollständig genug" ist, um es ohne erneute
 * Unternehmensbeschreibung für Content-Empfehlungen zu verwenden.
 * Kernfelder: Markenname + frei beschriebene "biz"-Fakten (offerings/products/USP).
 */
export function isBrandProfileComplete(profile: BrandProfile | null): boolean {
  if (!profile) return false;
  const hasName = !!profile.brandName?.trim();
  const hasOfferings =
    !!profile.offerings?.trim() ||
    (Array.isArray(profile.products) && profile.products.length > 0) ||
    !!profile.uniqueSellingPoint?.trim() ||
    !!profile.tagline?.trim();
  return hasName && hasOfferings;
}

export function saveBrandProfile(profile: BrandProfile): void {
  const toSave: BrandProfile = {
    ...profile,
    lastUpdated: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // localStorage may not be available
  }
}

export function clearBrandProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Returns a concise text summary of the brand profile for AI prompts.
 * Returns empty string if no profile is stored.
 */
export function getBrandContext(): string {
  const profile = getBrandProfile();
  if (!profile) return '';

  const parts: string[] = [];

  if (profile.brandName) parts.push(`- Marke: ${profile.brandName}`);
  if (profile.website) parts.push(`- Website: ${profile.website}`);
  if (profile.tagline) parts.push(`- Slogan/Tagline: ${profile.tagline}`);
  if (profile.offerings) parts.push(`- Angebot (was bietet/verkauft das Unternehmen): ${profile.offerings}`);
  if (Array.isArray(profile.products) && profile.products.length) parts.push(`- Produkte/Leistungen: ${profile.products.join(', ')}`);
  if (profile.uniqueSellingPoint) parts.push(`- USP (Unterscheidungsmerkmal): ${profile.uniqueSellingPoint}`);
  if (profile.targetAudience) parts.push(`- Zielgruppe: ${profile.targetAudience}`);
  if (profile.mainGoal) parts.push(`- Hauptziel: ${profile.mainGoal}`);
  if (profile.statusChallenge) parts.push(`- Aktueller Status / Herausforderung: ${profile.statusChallenge}`);
  if (profile.tone) parts.push(`- Tonalität: ${profile.tone}`);
  if (profile.brandVoice) parts.push(`- Markenstimme: ${profile.brandVoice}`);
  if (profile.avoidTopics) parts.push(`- Vermeiden: ${profile.avoidTopics}`);
  if (profile.neverClaim) parts.push(`- NIEMALS behaupten (harte Faktengrenze, absolut verboten): ${profile.neverClaim}`);

  if (parts.length === 0) return '';

  return `MARKENKONTEXT (authoritative Faktenbasis, bei allen Inhalten berücksichtigen — NUR diese Fakten verwenden, NICHTS erfinden):\n${parts.join('\n')}`;
}

/**
 * Returns true if a brand profile is configured.
 */
export function hasBrandProfile(): boolean {
  return getBrandProfile() !== null;
}

export { parseProducts };

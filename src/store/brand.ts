// ── Brand Profile Store ─────────────────────────────────────────────────────────
// In-memory store with localStorage persistence for brand profile.
// The brand context is automatically injected into every new strategy generation.

export interface BrandProfile {
  brandName: string;
  tagline: string;
  tone: string;
  targetAudience: string;
  uniqueSellingPoint: string;
  brandColors: string;
  competitors: string;
  products: string[];
  avoidTopics: string;
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
    return parsed;
  } catch {
    return null;
  }
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
  if (profile.tagline) parts.push(`- Slogan: ${profile.tagline}`);
  if (profile.tone) parts.push(`- Tonalität: ${profile.tone}`);
  if (profile.targetAudience) parts.push(`- Zielgruppe: ${profile.targetAudience}`);
  if (profile.uniqueSellingPoint) parts.push(`- USP: ${profile.uniqueSellingPoint}`);
  if (profile.avoidTopics) parts.push(`- Vermeiden: ${profile.avoidTopics}`);
  if (profile.brandVoice) parts.push(`- Markenstimme: ${profile.brandVoice}`);

  if (parts.length === 0) return '';

  return `MARKENKONTEXT (bei allen Inhalten berücksichtigen):\n${parts.join('\n')}`;
}

/**
 * Returns true if a brand profile is configured.
 */
export function hasBrandProfile(): boolean {
  return getBrandProfile() !== null;
}

export { parseProducts };

// ── Brand Profile Store ─────────────────────────────────────────────────────────
// In-memory store with localStorage persistence for brand profile.
// The brand context is automatically injected into every new strategy generation.

/**
 * Brand Kit (2026-11-16) — kuratierte, lizenzsichere Schriftfamilien.
 * Bewusst KEIN Font-Upload: jede Familie liegt eingebettet im Server-Renderer,
 * damit Vorschau, PNG und ZIP dieselbe Schrift zeigen. `''` = keine Wahl.
 */
export type BrandFontId = '' | 'sans' | 'serif' | 'mono';

/** Reihenfolge der Auswahl in der Oberfläche. */
export const BRAND_FONT_IDS: BrandFontId[] = ['sans', 'serif', 'mono'];

/** Ist der gespeicherte Wert eine wählbare Schrift? */
export function isBrandFontId(value: unknown): value is BrandFontId {
  return value === '' || value === 'sans' || value === 'serif' || value === 'mono';
}

/**
 * Logo-Data-URLs: NUR Rasterformate (PNG/JPEG/WebP). Kein SVG — ein SVG ist
 * kein Bild, sondern ausführbares Markup und müsste erst gerastert werden.
 */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function isBrandLogo(value: unknown): value is string {
  return typeof value === 'string' && LOGO_DATA_URL.test(value);
}

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
  /**
   * Brand Kit (2026-11-16) — optionales Logo als Data-URL
   * (`data:image/png|jpeg|webp;base64,…`, längste Kante ≤ 512 px, ≤ 300 KB).
   * Leerstring = kein Logo = die Pins sehen aus wie bisher.
   */
  logo: string;
  /**
   * Brand Kit (2026-11-16) — Schriftwahl. `''` und `'sans'` = die bisherige
   * Schrift (Liberation Sans); `'serif'`/`'mono'` = eine der kuratierten,
   * lizenzsicheren Familien. Alt-Profile ohne das Feld rendern unverändert.
   */
  fontId: BrandFontId;
  /**
   * Phase 1 (Stabilisierung, C4) — EIN/AUS-Schalter des Markenprofils.
   * `false` = das Profil bleibt gespeichert, wird aber NIRGENDS verwendet
   * (kein Markenkontext in Prompts, keine Vorbefüllung, keine Empfehlungen).
   * Fehlende Werte in Alt-Profilen gelten als `true` (Bestandsverhalten).
   */
  enabled: boolean;
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
    // Brand Kit (2026-11-16): Alt-Profile haben diese Felder nicht ⇒ kein Logo,
    // keine Schriftwahl ⇒ die Pins bleiben unverändert. Ein unbrauchbarer Wert
    // (z. B. SVG-Data-URL aus einer älteren Version) wird NICHT gelöscht, sondern
    // beim Laden als „kein Logo" gelesen.
    logo: isBrandLogo(profile.logo) ? profile.logo : '',
    fontId: isBrandFontId(profile.fontId) ? profile.fontId : '',
    // Alt-Profile ohne das Feld bleiben aktiv (keine Verhaltensänderung).
    enabled: profile.enabled !== false,
    lastUpdated: (profile as BrandProfile).lastUpdated ?? '',
  };
}

/** Phase 1 — ist das Markenprofil eingeschaltet? (kein Profil ⇒ false) */
export function isBrandProfileEnabled(): boolean {
  const profile = getBrandProfile();
  return profile !== null && profile.enabled !== false;
}

/**
 * Phase 1 — EIN/AUS schalten, ohne das Profil zu löschen. Fehlt ein Profil,
 * passiert nichts (es gibt nichts zu schalten).
 */
export function setBrandProfileEnabled(enabled: boolean): void {
  const profile = getBrandProfile();
  if (!profile) return;
  saveBrandProfile({ ...profile, enabled });
}

/**
 * Prüft, ob ein Markenprofil "vollständig genug" ist, um es ohne erneute
 * Unternehmensbeschreibung für Content-Empfehlungen zu verwenden.
 * Kernfelder: Markenname + frei beschriebene "biz"-Fakten (offerings/products/USP).
 */
export function isBrandProfileComplete(profile: BrandProfile | null): boolean {
  if (!profile) return false;
  // Phase 1: ein AUSgeschaltetes Profil ist keine nutzbare Faktenbasis.
  if (profile.enabled === false) return false;
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
 * Returns empty string if no profile is stored — und (Phase 1) auch dann,
 * wenn das Profil per Schalter AUSgeschaltet ist: dann wird nichts geliefert.
 */
export function getBrandContext(): string {
  const profile = getBrandProfile();
  if (!profile) return '';
  // C4/Phase 1: AUS ⇒ das Profil liefert NIRGENDS Kontext (eine Stelle, alle
  // Konsumenten erben das Verhalten: QuickGenerator, new-project, TikTok).
  if (profile.enabled === false) return '';

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

  // Phase 1 (C1/C2): Der Block ist ein Stil-/Faktenrahmen — NICHT das Thema.
  // Die Vorrang-Regel steht direkt im Block, damit sie in JEDEM Generator greift,
  // der diesen Text einbindet (QuickGenerator, new-project, TikTok).
  return [
    'MARKENKONTEXT (Stil- und Faktenrahmen — NUR diese Fakten verwenden, NICHTS erfinden):',
    parts.join('\n'),
    'VORRANG-REGEL (verbindlich): Inhalt und Gegenstand kommen AUS DER NUTZEREINGABE (Produktidee/Thema/Beschreibung). Nennt der Nutzer ein anderes Produkt, eine andere Branche oder ein anderes Thema als die Marke (z. B. „kleines Café", „Schmuck", „Weihnachts-Pin"), dann IST genau das das Thema — der Markenkontext liefert dann nur noch Tonalität, Markenstimme und Formulierungsstil. Ersetze oder überschreibe das Nutzerthema NIEMALS durch Markenfakten und baue das Nutzerthema nicht in ein Marketing für die Marke um. Passt der Markenkontext nicht zum Nutzerthema, ignoriere seine Fakten vollständig.',
  ].join('\n');
}

/**
 * Returns true if a brand profile is configured.
 */
export function hasBrandProfile(): boolean {
  return getBrandProfile() !== null;
}

export { parseProducts };

// ─────────────────────────────────────────────────────────────────────────────
// LEGAL-CONFIG — EINZIGE STELLE FÜR DIE RECHTSANGABEN DES BETREIBERS
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  HIER TRÄGT DIE OWNERIN IHRE ANGABEN EIN. Die Seiten /impressum und
//     /datenschutz lesen ausschließlich aus dieser Datei — es gibt keine
//     zweiten Kopien der Personalien im Code.
//
// Stand der Angaben: 2026-10-23 (von der Ownerin geliefert).
//
// NACHFÜLLEN VOR DEM PUBLIC LAUNCH:
//   1. CONTACT_EMAIL setzen  → Impressum + Datenschutz zeigen bis dahin „—".
//   2. VAT_ID / VAT_DISCLAIMER erst setzen, wenn die Kleinunternehmer-
//      Entscheidung (§ 19 UStG) gefallen ist. Solange beide leer sind,
//      erscheint im Impressum KEIN Abschnitt zur Umsatzsteuer (nichts wird
//      erfunden, keine feste Umsatzsteuer-Aussage).
// ─────────────────────────────────────────────────────────────────────────────

/** Name des Anbieters / Verantwortlicher i. S. d. § 18 Abs. 2 MStV. */
export const PROVIDER_NAME = 'Katharina Fahr';
/** Straße und Hausnummer — exakt wie von der Ownerin geliefert. */
export const PROVIDER_STREET = 'Hauptstr. 38';
/** Postleitzahl und Ort — exakt wie von der Ownerin geliefert. */
export const PROVIDER_CITY = '23619 Badendorf';
/** Land. */
export const PROVIDER_COUNTRY = 'Deutschland';

/**
 * Kontakt-E-Mail für Impressum, Datenschutz und Betroffenenanfragen.
 * LEER = noch nicht von der Ownerin geliefert → die Seiten zeigen „—".
 */
export const CONTACT_EMAIL = 'kontakt@growimo.app';

/**
 * Platzhalter, der sichtbar wird, solange CONTACT_EMAIL leer ist. Bewusst ein
 * Gedankenstrich (kein erfundenes Postfach), damit das Owner-Gegenlesen die
 * Struktur sieht und die fehlende Angabe sofort auffällt.
 */
export const CONTACT_EMAIL_PLACEHOLDER = '—';

/**
 * Umsatzsteuer-Identifikationsnummer nach § 27a UStG.
 * LEER = keine Nummer vorhanden/geliefert. Keine Nummer wird erfunden.
 */
export const VAT_ID = '';

/**
 * Umsatzsteuer-Hinweis (z. B. „Gemäß § 19 UStG wird keine Umsatzsteuer
 * berechnet."). LEER, solange die Kleinunternehmer-Entscheidung aussteht —
 * es wird KEINE feste Umsatzsteuer-Aussage eingebaut.
 */
export const VAT_DISCLAIMER = '';

/** Öffentliche Website des Angebots (Impressum-Pflichtangabe, § 5 DDG). */
export const WEBSITE_URL = 'https://growimo.app';

/** Stand der Rechtstexte (Anzeige „Stand: …"). */
export const LEGAL_LAST_UPDATED = '2026-10-23';

/** Anzeigewert für die Kontakt-E-Mail (CONTACT_EMAIL oder sichtbarer Platzhalter). */
export function contactEmailDisplay(): string {
  const value = CONTACT_EMAIL.trim();
  return value.length > 0 ? value : CONTACT_EMAIL_PLACEHOLDER;
}

/** Ist die Kontakt-E-Mail hinterlegt? (steuert z. B. mailto-Links) */
export function hasContactEmail(): boolean {
  return CONTACT_EMAIL.trim().length > 0;
}

/**
 * Soll der Umsatzsteuer-Abschnitt im Impressum erscheinen? Nur wenn eine
 * USt-IdNr. ODER ein Umsatzsteuer-Hinweis hinterlegt ist. Beides leer =
 * Abschnitt entfällt (nichts erfinden).
 */
export function hasVatInfo(): boolean {
  return VAT_ID.trim().length > 0 || VAT_DISCLAIMER.trim().length > 0;
}

/** Vollständige Anschrift als Zeilen (für Impressum/Datenschutz). */
export function providerAddressLines(): string[] {
  return [PROVIDER_NAME, PROVIDER_STREET, PROVIDER_CITY, PROVIDER_COUNTRY];
}

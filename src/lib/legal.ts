// ─────────────────────────────────────────────────────────────────────────────
// LEGAL-CONFIG — EINZIGE STELLE FÜR DIE RECHTSANGABEN DES BETREIBERS
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  HIER TRÄGT DIE OWNERIN IHRE ANGABEN EIN. Die Seiten /impressum,
//     /datenschutz, /agb und /widerruf lesen die Personalien ausschließlich aus
//     dieser Datei — es gibt keine zweiten Kopien im Code.
//
//     OFFEN (Owner-Frage 2026-10-25): AGB und Widerrufsbelehrung liegen nur auf
//     DEUTSCH vor. Für /agb und /widerruf existiert daher keine englische
//     Fassung; die englische Oberfläche zeigt einen Hinweis + den deutschen
//     Text. Es wird KEINE Übersetzung erfunden.
//
// Stand der Angaben: 2026-10-25 (von der Ownerin geliefert).
//
// NACHFÜLLEN VOR DEM PUBLIC LAUNCH:
//   1. CONTACT_EMAIL setzen  → Impressum + Datenschutz zeigen bis dahin „—".
//   2. ERLEDIGT 2026-11-04: Kleinunternehmerregelung § 19 UStG ist entschieden.
//      VAT_DISCLAIMER trägt den Owner-Wortlaut, VAT_ID bleibt leer (keine
//      USt-IdNr. vorhanden). Der Abschnitt „Umsatzsteuer" erscheint damit im
//      Impressum; AGB § 7 Abs. 7 und die Stripe-Rechnungsfußzeile tragen
//      denselben Satz.
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
 * Umsatzsteuer-Hinweis.
 *
 * Owner-Entscheidung 2026-11-04: Kleinunternehmerregelung nach § 19 UStG.
 * Wortlaut vom Owner vorgegeben — er steht deshalb WÖRTLICH hier und wird
 * unverändert an drei Stellen benutzt:
 *   1. Impressum, Abschnitt „Umsatzsteuer" (via `hasVatInfo()`),
 *   2. AGB § 7 (Abs. 7, `src/lib/legal-docs.ts`),
 *   3. Rechnungs-Fußzeile bei Stripe (`INVOICE_FOOTER` in
 *      `src/stripe/invoice-footer.ts` — dieselbe Konstante, keine zweite Kopie).
 * Es wird KEINE Umsatzsteuer berechnet oder ausgewiesen (kein Stripe Tax).
 *
 * Hinweis: Die übliche Standardformulierung lautet „Gemäß § 19 UStG wird keine
 * Umsatzsteuer berechnet." — der Owner hat bewusst den Wortlaut unten gewählt.
 */
export const VAT_DISCLAIMER =
  'Steuerbefreit für Kleinunternehmer gemäß § 19 UStG.';

/** Öffentliche Website des Angebots (Impressum-Pflichtangabe, § 5 DDG). */
export const WEBSITE_URL = 'https://growimo.app';

/** Stand der Rechtstexte (Anzeige „Stand: …"). */
export const LEGAL_LAST_UPDATED = '2026-11-04';

/**
 * Öffentliche Rechts-Routen. EINE Quelle für Footer, /app-Sidebar und Tests —
 * damit keine Referenz auf eine nicht existierende Route zeigt.
 *
 * Hinweis: Die AGB (`/agb`) und die Widerrufsbelehrung (`/widerruf`) sind am
 * 2026-10-25 aufgenommen worden (Owner-Freigabe). Ihre langen Texte stehen
 * NICHT hier, sondern in `src/lib/legal-docs.ts`; diese Datei bleibt die
 * einzige Quelle für die Betreiber-Angaben (Name, Anschrift, E-Mail, USt).
 */
export const LEGAL_ROUTES = {
  imprint: '/impressum',
  privacy: '/datenschutz',
  terms: '/agb',
  withdrawal: '/widerruf',
} as const;

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

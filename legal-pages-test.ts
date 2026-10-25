// ── Rechtstexte (Impressum + Datenschutz) — schlanke Suite ───────────────────
// Lauf: bun run legal-pages-test.ts
//
// Prüft:
//   1. Legal-Config: Owner-Daten exakt, nichts erfunden (keine USt-Angabe,
//      keine Telefonnummer), E-Mail-Platzhalter solange CONTACT_EMAIL leer.
//   2. i18n-Parität de/en inkl. aller neuen `legal_*`-Keys.
//   3. Beide Routen: head() liefert Titel + index,follow + absolute Canonical.
//   4. Beide Seiten rendern (SSR) ohne Crash und enthalten die Pflicht-Fakten
//      („Katharina Fahr", „§ 5 DDG", „Badendorf", „Hauptstr. 38").
//   5. Datenschutz nennt nur tatsächlich verbaute Verarbeitungen.
//   6. Footer (Landing + /app) verlinkt die echten Routen, keine toten "#"-Links.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';

import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import { I18nProvider } from './src/i18n';
import {
  CONTACT_EMAIL,
  CONTACT_EMAIL_PLACEHOLDER,
  LEGAL_LAST_UPDATED,
  LEGAL_ROUTES,
  PROVIDER_CITY,
  PROVIDER_COUNTRY,
  PROVIDER_NAME,
  PROVIDER_STREET,
  VAT_DISCLAIMER,
  VAT_ID,
  WEBSITE_URL,
  contactEmailDisplay,
  hasContactEmail,
  hasVatInfo,
  providerAddressLines,
} from './src/lib/legal';
import { AGB_SECTIONS, WIDERRUF_SECTIONS } from './src/lib/legal-docs';
import { Route as ImpressumRoute, ImpressumPage } from './src/routes/impressum';
import { Route as DatenschutzRoute, DatenschutzPage } from './src/routes/datenschutz';
import { Route as AgbRoute, AgbPage } from './src/routes/agb';
import { Route as WiderrufRoute, WiderrufPage } from './src/routes/widerruf';

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail = '') {
  checks++;
  if (!cond) {
    failures++;
    console.log('FAIL:', name, detail ? `— ${detail}` : '');
  } else {
    console.log('PASS:', name);
  }
}

function render(page: Parameters<typeof createElement>[0]): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, null, createElement(page as never, null)),
  );
}

// ── 1. Legal-Config: Owner-Daten exakt ───────────────────────────────────────
check('Name exakt „Katharina Fahr"', PROVIDER_NAME === 'Katharina Fahr', PROVIDER_NAME);
check('Straße exakt „Hauptstr. 38"', PROVIDER_STREET === 'Hauptstr. 38', PROVIDER_STREET);
check('Ort exakt „23619 Badendorf"', PROVIDER_CITY === '23619 Badendorf', PROVIDER_CITY);
check('Land „Deutschland"', PROVIDER_COUNTRY === 'Deutschland', PROVIDER_COUNTRY);
check(
  'Anschrift-Zeilen vollständig',
  providerAddressLines().join('|') ===
    'Katharina Fahr|Hauptstr. 38|23619 Badendorf|Deutschland',
  providerAddressLines().join('|'),
);
check('Website-URL growimo.app', WEBSITE_URL === 'https://growimo.app', WEBSITE_URL);
check('Stand gesetzt (2026-10-25)', LEGAL_LAST_UPDATED === '2026-10-25', LEGAL_LAST_UPDATED);

// Keine erfundenen Angaben: USt bleibt leer, bis die Ownerin entscheidet.
check('keine USt-IdNr. erfunden', VAT_ID === '', VAT_ID);
check('kein Umsatzsteuer-Hinweis erfunden', VAT_DISCLAIMER === '', VAT_DISCLAIMER);
check('USt-Abschnitt bleibt aus (hasVatInfo=false)', hasVatInfo() === false);

// E-Mail: entweder echter Wert oder sichtbarer Platzhalter „—".
if (CONTACT_EMAIL.trim().length === 0) {
  check('CONTACT_EMAIL leer → Platzhalter „—"', contactEmailDisplay() === CONTACT_EMAIL_PLACEHOLDER);
  check('Platzhalter ist ein Gedankenstrich', CONTACT_EMAIL_PLACEHOLDER === '—', CONTACT_EMAIL_PLACEHOLDER);
  check('hasContactEmail() = false bei leerer E-Mail', hasContactEmail() === false);
} else {
  check('CONTACT_EMAIL gesetzt → wird angezeigt', contactEmailDisplay() === CONTACT_EMAIL.trim());
  check('hasContactEmail() = true', hasContactEmail() === true);
}

// ── 2. i18n-Parität ─────────────────────────────────────────────────────────
const deKeys = Object.keys(de);
const enKeys = Object.keys(en);
check('de/en Key-Anzahl gleich', deKeys.length === enKeys.length, `${deKeys.length} vs ${enKeys.length}`);
check(
  'kein de-Key fehlt in en',
  deKeys.filter((k) => !(k in en)).length === 0,
  deKeys.filter((k) => !(k in en)).join(','),
);
check(
  'kein en-Key fehlt in de',
  enKeys.filter((k) => !(k in de)).length === 0,
  enKeys.filter((k) => !(k in de)).join(','),
);

const legalDe = deKeys.filter((k) => k.startsWith('legal_'));
const legalEn = enKeys.filter((k) => k.startsWith('legal_'));
check('legal_-Keys in de vorhanden', legalDe.length > 80, String(legalDe.length));
check(
  'legal_-Keys de/en identisch',
  legalDe.length === legalEn.length && legalDe.every((k) => k in en),
  `${legalDe.length} vs ${legalEn.length}`,
);
check(
  'kein legal_-Wert leer (de)',
  legalDe.every((k) => String((de as Record<string, unknown>)[k]).trim().length > 0),
);
check(
  'kein legal_-Wert leer (en)',
  legalEn.every((k) => String((en as Record<string, unknown>)[k]).trim().length > 0),
);
// Pflicht-Überschriften in beiden Sprachen
check('de: „§ 5 DDG"', String(de.legal_imprint_ddg_heading).includes('§ 5 DDG'));
check('en: „§ 5 DDG"', String(en.legal_imprint_ddg_heading).includes('§ 5 DDG'));
check('de: „§ 18 Abs. 2 MStV"', String(de.legal_imprint_responsible_heading).includes('§ 18 Abs. 2 MStV'));
check('en: „§ 18 (2) MStV"', String(en.legal_imprint_responsible_heading).includes('§ 18 (2) MStV'));
check('de: DSGVO in Rechtsgrundlage', String(de.legal_privacy_account_basis).includes('DSGVO'));
check('en: GDPR in Rechtsgrundlage', String(en.legal_privacy_account_basis).includes('GDPR'));

// ── 3. Routen-Head ──────────────────────────────────────────────────────────
const impHead = ImpressumRoute.options.head?.() as
  | { meta?: Array<Record<string, string>>; links?: Array<{ rel: string; href: string }> }
  | undefined;
const priHead = DatenschutzRoute.options.head?.() as
  | { meta?: Array<Record<string, string>>; links?: Array<{ rel: string; href: string }> }
  | undefined;

const metaOf = (h: typeof impHead, key: string, field = 'name') =>
  (h?.meta ?? []).find((m) => m[field] === key)?.content ?? '';
// Der <title> steht als { title: '…' } in den Meta-Objekten (kein name/content).
const titleOf = (h: typeof impHead) =>
  (h?.meta ?? []).map((m) => (m as { title?: string }).title).find((x) => typeof x === 'string') ?? '';

check('Impressum: Titel gesetzt', titleOf(impHead).length > 0, titleOf(impHead));
check('Impressum: index,follow', metaOf(impHead, 'robots') === 'index,follow', metaOf(impHead, 'robots'));
check(
  'Impressum: absolute Canonical',
  (impHead?.links ?? []).some((l) => l.rel === 'canonical' && l.href === 'https://www.growimo.app/impressum'),
  JSON.stringify(impHead?.links),
);
check('Datenschutz: Titel gesetzt', titleOf(priHead).length > 0, titleOf(priHead));
check('Datenschutz: index,follow', metaOf(priHead, 'robots') === 'index,follow', metaOf(priHead, 'robots'));
check(
  'Datenschutz: absolute Canonical',
  (priHead?.links ?? []).some((l) => l.rel === 'canonical' && l.href === 'https://www.growimo.app/datenschutz'),
  JSON.stringify(priHead?.links),
);

// ── 4. Impressum rendert (SSR, de = Default beim ersten Render) ─────────────
const impHtml = render(ImpressumPage);
check('Impressum rendert', impHtml.length > 500, String(impHtml.length));
check('Impressum: „Impressum"', impHtml.includes('Impressum'));
check('Impressum: „Angaben gemäß § 5 DDG"', impHtml.includes('Angaben gemäß § 5 DDG'));
check('Impressum: Name „Katharina Fahr"', impHtml.includes('Katharina Fahr'));
check('Impressum: „Hauptstr. 38"', impHtml.includes('Hauptstr. 38'));
check('Impressum: „23619 Badendorf"', impHtml.includes('23619 Badendorf'));
check('Impressum: „Deutschland"', impHtml.includes('Deutschland'));
check('Impressum: Website-Link growimo.app', impHtml.includes('https://growimo.app'));
check('Impressum: § 18 Abs. 2 MStV', impHtml.includes('§ 18 Abs. 2 MStV'));
check('Impressum: § 36 VSBG', impHtml.includes('§ 36 VSBG'));
check('Impressum: kein „undefined"/„NaN"', !impHtml.includes('undefined') && !impHtml.includes('NaN'));
// Nichts erfunden:
check('Impressum: keine Telefonnummer', !/Telefon|Tel\.|phone/i.test(impHtml));
check('Impressum: kein Handelsregister', !/Handelsregister|Amtsgericht/i.test(impHtml));
check('Impressum: keine USt-Angabe', !/USt-IdNr|Umsatzsteuer-Identifikationsnummer/i.test(impHtml));
check(
  'Impressum: E-Mail = Platzhalter oder echter Wert',
  impHtml.includes(CONTACT_EMAIL.trim() || CONTACT_EMAIL_PLACEHOLDER),
);

// ── 5. Datenschutz rendert + nennt nur verbaute Verarbeitungen ──────────────
const priHtml = render(DatenschutzPage);
check('Datenschutz rendert', priHtml.length > 2000, String(priHtml.length));
check('Datenschutz: Verantwortlicher = Katharina Fahr', priHtml.includes('Katharina Fahr'));
check('Datenschutz: „23619 Badendorf"', priHtml.includes('23619 Badendorf'));
check('Datenschutz: Clerk', priHtml.includes('Clerk'));
check('Datenschutz: OpenAI', priHtml.includes('OpenAI'));
check('Datenschutz: Stripe', priHtml.includes('Stripe'));
check('Datenschutz: Neon', priHtml.includes('Neon'));
check('Datenschutz: Vercel', priHtml.includes('Vercel'));
check('Datenschutz: Sitzungs-Cookie __session', priHtml.includes('__session'));
check('Datenschutz: Besucher-Cookie growimo_vid', priHtml.includes('growimo_vid'));
check('Datenschutz: 90 Tage (Analyse/Bilder)', priHtml.includes('90 Tage'));
check('Datenschutz: Rechtsgrundlage Art. 6 Abs. 1 lit. b', priHtml.includes('Art. 6 Abs. 1 lit. b'));
check('Datenschutz: Einwilligung Art. 6 Abs. 1 lit. a', priHtml.includes('Art. 6 Abs. 1 lit. a'));
check('Datenschutz: berechtigtes Interesse lit. f', priHtml.includes('lit. f DSGVO'));
check('Datenschutz: Auskunft Art. 15', priHtml.includes('Art. 15 DSGVO'));
check('Datenschutz: Löschung Art. 17', priHtml.includes('Art. 17 DSGVO)'));
check('Datenschutz: Beschwerderecht Art. 77', priHtml.includes('Art. 77 DSGVO'));
check('Datenschutz: TLS-Hinweis', /TLS-Verbindung/.test(priHtml));
check('Datenschutz: kein „undefined"/„NaN"', !priHtml.includes('undefined') && !priHtml.includes('NaN'));
// Keine erfundenen Prozessoren (bewusst NICHT im Code verbaut):
for (const bogus of ['Google Analytics', 'Facebook', 'Mailchimp', 'Sentry', 'HubSpot', 'Matomo']) {
  check(`Datenschutz: kein erfundener Dienst „${bogus}"`, !priHtml.includes(bogus));
}

// ── 5b. Owner-Review 2026-10-23: Widerruf + korrigierte Angaben ─────────────
// (1) Sichtbarer Opt-out-Schalter in § 4.2 — er muss serverseitig gerendert
//     werden, damit er ohne JavaScript und in Tests nachweisbar ist.
check('Datenschutz: Opt-out-Schalter gerendert', priHtml.includes('data-testid="analytics-optout"'));
check('Datenschutz: Opt-out-Button gerendert', priHtml.includes('data-testid="analytics-optout-button"'));
check(
  'Datenschutz: Opt-out nennt den Speicher-Schlüssel',
  priHtml.includes('growimo_analytics_optout'),
);
check(
  'Datenschutz: Widerruf verweist auf den Schalter (nicht auf Browser-Löschen)',
  String(de.legal_privacy_cookies_visitor_body).includes('Schalter') &&
    !String(de.legal_privacy_cookies_visitor_body).includes('indem du diese Speicherung und das Cookie'),
);
// (2) Beta-Warteliste (beta_signups) ist jetzt beschrieben.
check('Datenschutz: Beta-Warteliste genannt', priHtml.includes('Beta-Warteliste'));
check('Datenschutz: Beta-Warteliste de/en', String(de.legal_privacy_beta_heading).length > 0 && String(en.legal_privacy_beta_heading).length > 0);
// (3) Bilder: 90 Tage + 200er-Obergrenze (Code: IMAGE_TTL_DAYS_DEFAULT=90,
//     IMAGE_MAX_PER_USER_DEFAULT=200, delete_reason 'cap_200').
check(
  'Datenschutz: Bilder-TTL 90 Tage',
  String(de.legal_privacy_images_retention).includes('90 Tage'),
);
check(
  'Datenschutz: Bilder-Obergrenze 200 genannt',
  String(de.legal_privacy_images_retention).includes('200') &&
    String(en.legal_privacy_images_retention).includes('200'),
);
// (4) Drittland: nur belegbare Mechanismen (SCC + DPF-Kategorie), EU-Region
//     der Datenbank (DATABASE_URL: eu-central-1).
check(
  'Datenschutz: Standardvertragsklauseln genannt',
  String(de.legal_privacy_third_country_body).includes('Standardvertragsklauseln') &&
    String(en.legal_privacy_third_country_body).includes('standard contractual clauses'),
);
check(
  'Datenschutz: DPF als Kategorie (nicht als Einzelzertifizierung)',
  String(de.legal_privacy_third_country_body).includes('soweit der jeweilige Anbieter nach dem EU-US Data Privacy Framework zertifiziert ist'),
);
check(
  'Datenschutz: Neon-Datenbank in der EU genannt',
  String(de.legal_privacy_third_country_body).includes('Europäischen Union'),
);
check(
  'Datenschutz: keine erfundenen Vertragsnummern/Detailangaben',
  !/SCC-[0-9]|DPF-[0-9]|Vertragsnummer/i.test(priHtml),
);
// (5) Keine Monats-Reset-Behauptung mehr (Kontingent ist seit 2026-10-22
//     einmalig; ein "monatlich zurückgesetzt" wäre falsch).
check(
  'Datenschutz: kein „monatlich zurückgesetzt"',
  !/monatlich zurückgesetzt|jeden Monat zurückgesetzt|reset monthly/i.test(priHtml),
);
// (6) localStorage-Claim korrigiert: localStorage überlebt den Tab.
check(
  'Datenschutz: localStorage vs. sessionStorage korrekt getrennt',
  String(de.legal_privacy_cookies_local_body).includes('localStorage bleiben dagegen in deinem Browser gespeichert') &&
    !String(de.legal_privacy_cookies_local_body).includes('Sitzungsdaten werden nicht auf unseren Servern gespeichert und mit dem Schließen'),
);
// (7) Analyse-Löschung präzise (Lazy-TTL bei der Auswertung).
check(
  'Datenschutz: Analyse-TTL präzise beschrieben',
  String(de.legal_privacy_analytics_retention).includes('Löschlauf') &&
    String(en.legal_privacy_analytics_retention).includes('deletion run'),
);

// ── 6. Footer-Verdrahtung ───────────────────────────────────────────────────
const landing = readFileSync('./src/components/LandingPage.tsx', 'utf8');
const appLayout = readFileSync('./src/routes/app.tsx', 'utf8');
const legalLayout = readFileSync('./src/components/LegalLayout.tsx', 'utf8');
check('Landing-Footer → /impressum', landing.includes('href: "/impressum"'));
check('Landing-Footer → /datenschutz', landing.includes('href: "/datenschutz"'));
check('Landing-Footer → /agb', landing.includes('href: "/agb"'));
check('Landing-Footer → /widerruf', landing.includes('href: "/widerruf"'));
check('Landing-Footer: kein toter Rechts-Link mehr', !/label: t\.footer_(privacy|imprint|terms), href: "#"/.test(landing));
check('/app-Sidebar → /impressum', appLayout.includes('href="/impressum"'));
check('/app-Sidebar → /datenschutz', appLayout.includes('href="/datenschutz"'));
check('/app-Sidebar → /agb', appLayout.includes('href="/agb"'));
check('/app-Sidebar → /widerruf', appLayout.includes('href="/widerruf"'));
check('LegalLayout-Footer → /agb', legalLayout.includes('href="/agb"'));
check('LegalLayout-Footer → /widerruf', legalLayout.includes('href="/widerruf"'));

// ── 7. AGB + Widerrufsbelehrung (Owner-Freigabe 2026-10-25) ─────────────────
// (1) Inhalt kommt aus src/lib/legal-docs.ts (maschinell aus den Freigabe-
//     Dokumenten) — kein zweiter, abweichender Wortlaut im Code.
check('AGB: 16 Abschnitte (§ 1 – § 16)', AGB_SECTIONS.length === 16, String(AGB_SECTIONS.length));
check(
  'AGB: § 1 Geltungsbereich zuerst',
  AGB_SECTIONS[0]?.title.includes('Geltungsbereich') === true,
  AGB_SECTIONS[0]?.title,
);
check(
  'AGB: § 11 Widerrufsrecht enthalten',
  AGB_SECTIONS.some((s) => s.title.includes('Widerrufsrecht')),
);
check(
  'Widerruf: Muster-Widerrufsformular enthalten',
  WIDERRUF_SECTIONS.some((s) => s.title.includes('Muster-Widerrufsformular')),
);
check(
  'Widerruf: Widerrufsfolgen enthalten',
  WIDERRUF_SECTIONS.some((s) => s.title.includes('Widerrufsfolgen')),
);

const docText = JSON.stringify([AGB_SECTIONS, WIDERRUF_SECTIONS]);
// Redaktions-Artefakte dürfen NICHT auf einer öffentlichen Seite landen.
check('Rechtstexte: keine ⟨…⟩-Änderungsvermerke', !/[⟨⟩]/.test(docText));
check('Rechtstexte: keine „[OFFEN"-Kästen', !docText.includes('[OFFEN'));
check('Rechtstexte: keine „Bisherige Fassung"-Notizen', !docText.includes('Bisherige Fassung'));
check('Rechtstexte: keine Statuskästen (STATUS 2026)', !docText.includes('STATUS 2026'));
check('Rechtstexte: kein „KORRIGIERT"/„ERGÄNZT"', !/KORRIGIERT|ERGÄNZT|PRÄZISIERT/.test(docText));
// Pflicht-Fakten aus der Freigabe-Fassung
check('AGB: Free = 3 Generierungen einmalig', docText.includes('3 KI-Generierungen — einmalig pro Nutzerkonto'));
check('AGB: Pro 19 € / 200 Generierungen', docText.includes('19 € pro Monat') && docText.includes('200 Generierungen'));
check('AGB: Vertragssprache Deutsch (§ 16 Abs. 6)', docText.includes('Vertragssprache ist Deutsch'));
check('AGB: kein „unbegrenzt"-Tarif behauptet', docText.includes('Ein Tarif mit unbegrenzten Generierungen wird nicht angeboten'));
check('Widerruf: vierzehn Tage', docText.includes('vierzehn Tagen'));
check('Widerruf: § 356 Abs. 5 BGB', docText.includes('§ 356 Abs. 5 BGB'));
check('Widerruf: Wertersatz § 357a', docText.includes('§ 357a Abs. 1 BGB'));
check('Widerruf: Rechenbeispiel 3,80 €', docText.includes('3,80 €'));
// Betreiber-Angaben müssen mit src/lib/legal.ts übereinstimmen (keine
// zweite, abweichende Anschrift in den langen Texten).
for (const [label, value] of [
  ['Name', PROVIDER_NAME],
  ['Straße', PROVIDER_STREET],
  ['Ort', PROVIDER_CITY],
  ['Land', PROVIDER_COUNTRY],
] as const) {
  check(`Rechtstexte: ${label} identisch mit legal.ts`, docText.includes(value), value);
}
if (CONTACT_EMAIL.trim().length > 0) {
  check('Rechtstexte: Kontakt-E-Mail identisch mit legal.ts', docText.includes(CONTACT_EMAIL));
}

// (2) Routen-Head von /agb und /widerruf
const agbHead = AgbRoute.options.head?.() as typeof impHead;
const widHead = WiderrufRoute.options.head?.() as typeof impHead;
check('AGB: Titel gesetzt', titleOf(agbHead).length > 0, titleOf(agbHead));
check('AGB: index,follow', metaOf(agbHead, 'robots') === 'index,follow', metaOf(agbHead, 'robots'));
check(
  'AGB: absolute Canonical',
  (agbHead?.links ?? []).some((l) => l.rel === 'canonical' && l.href === 'https://www.growimo.app/agb'),
  JSON.stringify(agbHead?.links),
);
check('Widerruf: Titel gesetzt', titleOf(widHead).length > 0, titleOf(widHead));
check('Widerruf: index,follow', metaOf(widHead, 'robots') === 'index,follow', metaOf(widHead, 'robots'));
check(
  'Widerruf: absolute Canonical',
  (widHead?.links ?? []).some((l) => l.rel === 'canonical' && l.href === 'https://www.growimo.app/widerruf'),
  JSON.stringify(widHead?.links),
);

// (3) Seiten rendern (SSR) und enthalten die Pflicht-Inhalte
const agbHtml = render(AgbPage);
check('AGB rendert', agbHtml.length > 5000, String(agbHtml.length));
check('AGB: Überschrift', agbHtml.includes('Allgemeine Geschäftsbedingungen'));
check('AGB: Stand 2026-10-25', agbHtml.includes('2026-10-25'));
check('AGB: § 1', agbHtml.includes('§ 1 Geltungsbereich'));
check('AGB: § 16', agbHtml.includes('§ 16 Kontakt'));
check('AGB: Tarif-Tabelle', agbHtml.includes('<table') && agbHtml.includes('Beta-Rabatt'));
check('AGB: Querverweis auf /widerruf', agbHtml.includes('href="/widerruf"'));
check('AGB: Querverweis auf /datenschutz', agbHtml.includes('href="/datenschutz"'));
check('AGB: kein „undefined"/„NaN"', !agbHtml.includes('undefined') && !agbHtml.includes('NaN'));
check('AGB: kein Änderungsvermerk sichtbar', !/[⟨⟩]/.test(agbHtml));
check('AGB: keine „[OFFEN"-Box sichtbar', !agbHtml.includes('[OFFEN'));

const widHtml = render(WiderrufPage);
check('Widerruf rendert', widHtml.length > 4000, String(widHtml.length));
check('Widerruf: Überschrift', widHtml.includes('Widerrufsbelehrung'));
check('Widerruf: Stand 2026-10-25', widHtml.includes('2026-10-25'));
check('Widerruf: Muster-Widerrufsformular', widHtml.includes('Muster-Widerrufsformular'));
check('Widerruf: Ausfülllinien', widHtml.includes('border-b border-gray-300'));
check('Widerruf: Querverweis auf /agb', widHtml.includes('href="/agb"'));
check('Widerruf: E-Mail als mailto', widHtml.includes('href="mailto:kontakt@growimo.app"'));
check('Widerruf: kein „undefined"/„NaN"', !widHtml.includes('undefined') && !widHtml.includes('NaN'));

// (4) Englische Fassung fehlt (offene Owner-Frage) — der Hinweis muss in beiden
//     Sprachen existieren, damit die EN-Oberfläche nicht ins Leere läuft.
check(
  'EN-Hinweis de/en vorhanden',
  String(de.legal_en_notice_heading).length > 0 &&
    String(en.legal_en_notice_heading).length > 0 &&
    String(de.legal_en_notice_body).length > 0 &&
    String(en.legal_en_notice_body).length > 0,
);
check(
  'EN-Hinweis nennt die deutsche Fassung als maßgeblich',
  String(en.legal_en_notice_body).includes('German version is authoritative') &&
    String(de.legal_en_notice_body).includes('maßgeblich ist die deutsche Fassung'),
);

// (5) Kein toter Rechts-Link: jede im Code referenzierte Rechts-Route muss als
//     Routendatei existieren (und umgekehrt jede Route erreichbar sein).
const routeFiles = new Set(
  readdirSync('./src/routes')
    .filter((f) => f.endsWith('.tsx') && !f.startsWith('__') && !f.startsWith('app'))
    .map((f) => '/' + f.replace(/\.tsx$/, '')),
);
for (const route of Object.values(LEGAL_ROUTES)) {
  check(`Route existiert: ${route}`, routeFiles.has(route), [...routeFiles].join(','));
}
const referenced = new Set<string>();
for (const file of [
  './src/components/LandingPage.tsx',
  './src/components/LegalLayout.tsx',
  './src/routes/app.tsx',
  './src/routes/agb.tsx',
  './src/routes/widerruf.tsx',
  './src/routes/app/pricing.tsx',
  './src/routes/app/billing.tsx',
]) {
  const src = readFileSync(file, 'utf8');
  for (const match of src.matchAll(/href[:=]\s*\{?"(\/[a-z-]+)"/g)) {
    referenced.add(match[1]);
  }
}
for (const href of referenced) {
  const isLegal = href === '/agb' || href === '/widerruf' || href === '/impressum' || href === '/datenschutz';
  if (!isLegal) continue;
  check(`Rechts-Link ${href} hat eine Route`, routeFiles.has(href));
}
check('mind. 4 Rechts-Links im Code gefunden', referenced.size >= 4, [...referenced].join(','));

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

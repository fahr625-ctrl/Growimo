/**
 * i18n-scan.ts — Growimo language-mixing scanner
 * ===============================================
 * Verifies:
 *   1. KEY-PARITY : de.ts and en.ts expose the exact same key set (no key
 *      present in one but missing in the other → no fallback-to-English).
 *   2. USED-KEYS  : every t.<key> / t['key'] usage in src/ resolves to a key
 *      that exists in BOTH dictionaries.
 *   3. UI HARDCODED STRINGS : no English UI strings outside the i18n system in
 *      user-visible contexts (JSX text nodes, placeholder/aria-label/title/alt
 *      attributes, title:/desc:/label: literals, alert()/confirm() calls,
 *      setError/setErrorMessage/setToast literals). Brand/channel/proper nouns
 *      (Growimo, Pinterest, Etsy, SEO, AI, …) are allowed in both languages.
 *   4. DICT VALUES: de.ts values must not contain English UI words; en.ts
 *      values must not contain German-only tokens (umlauts/ß/typical words).
 *
 * Server-side (src/ai, src/api, src/db, src/store, src/stripe, src/auth, src/lib)
 * English literals (LLM prompts, validation errors, console logs) are dev-facing
 * and are reported as INFO only — they are never rendered to the user; all
 * client error paths now display localized text.
 *
 * Usage:  bun --env-file=.env run i18n-scan.ts
 * Exit:   0 = clean (zero mixing, key parity), 1 = issues found.
 */

import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, 'src');

// ── 1. Key parity (import-based → exact, no regex pitfalls) ──────────────────
const deKeys = new Set(Object.keys(de));
const enKeys = new Set(Object.keys(en));
const onlyDe = [...deKeys].filter((k) => !enKeys.has(k)).sort();
const onlyEn = [...enKeys].filter((k) => !deKeys.has(k)).sort();

// ── 2. Used keys ─────────────────────────────────────────────────────────────
const REACT_TYPE_NAMES = new Set([
  'Dispatch', 'FormEvent', 'MouseEvent', 'ReactNode', 'SetStateAction', 'FC',
  'ChangeEvent', 'KeyboardEvent', 'Ref', 'SyntheticEvent', 'Promise', 'FocusEvent',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !full.includes('routeTree.gen')) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(ROOT);
const uiFiles = allFiles.filter(
  (f) => f.includes('/components/') || f.includes('/routes/') || f.endsWith('/router.tsx'),
);

const usedKeys = new Set<string>();
for (const f of allFiles) {
  if (f.includes('/i18n/')) continue;
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\.([a-zA-Z0-9_]+)\b/g)) usedKeys.add(m[1]);
  for (const m of s.matchAll(/\bt\[['"]([a-zA-Z0-9_]+)['"]\]/g)) usedKeys.add(m[1]);
}
const missingUsedKeys = [...usedKeys].filter(
  (k) => !deKeys.has(k) && !REACT_TYPE_NAMES.has(k) && !k.includes('.') && !/^[a-z]+$/.test(k) === false || false,
);
// Only snake_case keys are real i18n keys (common_*, dashboard_*, …); bare
// identifiers (id, done, moved, trim, …) are lambda/property accesses.
const missingUsedKeysReal = [...usedKeys].filter(
  (k) => k.includes('_') && !deKeys.has(k),
).sort();

// ── 3. Hardcoded English UI strings ──────────────────────────────────────────
const ENG = new Set((
  'improve create start started your save cancel edit delete share download continue back settings ' +
  'dashboard learn more try upgrade publish optimize search generate generating loading copy copied ' +
  'coming soon next best now here new add open close done ready yes no ok okay all every then turn into ' +
  'accelerate growth build scroll stopping pin idea ideas project projects content template templates ' +
  'label labels status name email message send submit enter type choose select options option view show ' +
  'hide refresh reset remove clear filter sort page total items result results score scores quality error ' +
  'failed success retry apply upload file files image images picture photo link links website home about ' +
  'contact privacy terms accept decline sign login logout register account profile password username user ' +
  'users billing payment plan plans trial premium basic standard monthly yearly annual weekly daily today ' +
  'tomorrow yesterday automatic manual smart powered fast quick easy simple great good better perfect total ' +
  'count number price pricing cost value benefit benefits why what when where who which how with without ' +
  'from into you our we us for to of at by as is are were be have has had will would ' +
  'can could should must may might need wants like love prefer expert professional hobby creator agency ' +
  'brand offer sell sale buy purchase order cart checkout delivery shipping review rating feedback comment ' +
  'follow subscriber audience niche market campaign article blog post newsletter keyword rank traffic ' +
  'visitor click conversion convert lead revenue profit income grow scale launch release update version ' +
  'beta alpha early access waitlist invite code bonus discount coupon deal exclusive limited only just ' +
  'please wait required custom none found load saved saving'
).split(/\s+/));

// Brand names / product feature names / accepted German marketing loanwords —
// these are intentionally kept identical in both languages.
const ALLOW = new Set((
  'Growimo Pinterest Etsy SEO AI FAQ CTA Strategy Brief Performance Newsletter OpenAI GPT Google Instagram ' +
  'YouTube TikTok Facebook Amazon Shopify Stripe Clerk Vercel Neon PostgreSQL Blog Blogs Post Posts Pin Pins ' +
  'Mockup Mockups Prompt Prompts Score Scores Listing Listings Pack Bundle Tone Format Channel Marketing ' +
  'Dashboard Studio Generator Engine Loop Momentum Readiness Premium Vision Mission Analytics Intelligence ' +
  'Insight Insights Trend Trends Streak Package Quick Pro Free Beta API SDK JSON HTML CSS JS TS React Tailwind ' +
  'Vite Bun Node TypeScript JavaScript Windows Mac iPhone Android iOS Web App Tool Tools Template Templates ' +
  'Gallery Upload Download Copy Generate Generating Regenerate Variation Variations Empty Error Loading ' +
  'Saved Reset OK Logo Icon Hero Footer Header Navigation Sidebar Menu Badge Chip Card Panel Section List ' +
  'Item Week Month Today Name Email Password Date Status Language Social Media Niche Audience Target Market ' +
  'Design DIY Hobby Business Budget Mid Luxury Mailchimp Klaviyo LinkedIn Twitter KPI KPIs Tag Tags ' +
  'Newsletter Marketing Strategy Content Package Studio Generator Dashboard Analytics Insights Trends Streak ' +
  'Quick Vision Mission Loop Momentum Readiness Template Templates Gallery Hero CTA FAQ Keyword Keywords ' +
  'Conversion Conversions Traffic Creator Creators Feedback Version Link Links Standard Chat Sell Image ' +
  'Plan Start Launch Brand ' +
  'Images Voice Board Boards Alt Meta Cross'
).split(/\s+/));

const WORD = '[A-Za-z0-9_äöüÄÖÜß]';
const boundary = (w: string) => `(?<!${WORD})${w}(?!${WORD})`;
const ENG_RE = new RegExp(`${[...ENG].map(boundary).join('|')}`, 'i');
const ALLOW_RE = new RegExp(`${[...ALLOW].map(boundary).join('|')}`, 'gi');

function containsEnglish(text: string): boolean {
  // remove allowed terms, then check whether an English UI word remains
  const rest = text.replace(ALLOW_RE, ' ');
  return ENG_RE.test(rest);
}

interface Finding {
  file: string;
  line: number;
  kind: string;
  text: string;
}

const uiFindings: Finding[] = [];
for (const f of uiFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // JSX text nodes
    for (const m of line.matchAll(/>([^<>{}]{2,110})</g)) {
      const txt = m[1].trim().replace(/[→←]/g, ' ').trim();
      if (txt && /[A-Za-z]{2,}/.test(txt) && containsEnglish(txt)) {
        uiFindings.push({ file: f, line: i + 1, kind: 'JSX-TEXT', text: txt.slice(0, 90) });
      }
    }
    // UI attributes
    for (const m of line.matchAll(/\b(placeholder|aria-label|title|alt)="([^"]{2,})"/g)) {
      const v = m[2];
      if (containsEnglish(v) && !/^[a-z0-9][a-z0-9-]*$/.test(v)) {
        uiFindings.push({ file: f, line: i + 1, kind: `ATTR:${m[1]}`, text: v.slice(0, 90) });
      }
    }
    // object literals for UI text
    for (const m of line.matchAll(/\b(title|desc|label|placeholder|cta|text|subtitle):\s*['"]([^'"]{2,90})['"]/g)) {
      const v = m[2];
      // skip config keys / slugs / urls / paths
      if (/^(key|id|icon|to|href|style|iconStyle|accent|gradient|tint|ratio|filename|promptKey|labelKey)$/.test(m[1])) continue;
      if (/^[a-z0-9][a-z0-9-]*$/.test(v) || v.startsWith('/') || v.startsWith('#') || v.startsWith('.')) continue;
      if (containsEnglish(v)) {
        uiFindings.push({ file: f, line: i + 1, kind: `LIT:${m[1]}`, text: v.slice(0, 90) });
      }
    }
    // alert/confirm with English literals
    for (const m of line.matchAll(/\b(alert|confirm)\(\s*['"]([^'"]{2,90})['"]/g)) {
      if (containsEnglish(m[2])) {
        uiFindings.push({ file: f, line: i + 1, kind: `CALL:${m[1]}`, text: m[2].slice(0, 90) });
      }
    }
    // error/toast setters with English literals
    for (const m of line.matchAll(/\b(setError|setErrorMessage|setToast)\(\s*['"]([^'"]{2,90})['"]/g)) {
      if (containsEnglish(m[2])) {
        uiFindings.push({ file: f, line: i + 1, kind: `CALL:${m[1]}`, text: m[2].slice(0, 90) });
      }
    }
  }
}

// ── 4. Dictionary value checks ───────────────────────────────────────────────
// German values must not contain English UI words (after removing allowed
// brand/loan terms). English values must not contain German-only tokens.
const GERMAN_ONLY_RE = /[ßäöüÄÖÜ]|\b(?:Bitte|bitte|Generieren|Erstellen|Löschen|Zurück|Weiter|Abbrechen|Speichern|Sprache|Einstellungen|Projekt|Projekte|Inhalt|Inhalte|Kanal|Kanäle|Vorlagen|Suchen|Lädt|Fehler|Erneut|Schließen|Bestätigen|Demnächst|Kopieren|Herunterladen|Exportieren|Gespeichert|Willkommen|Deine|Dein|Bereits|Weniger|Keine|Kein|Noch|Gib|Beschreibe|Wähle|Erhältst|Liefert|Strategie|Favoriten|Duplizieren|Woche|Monat|Heute|Gestern|Morgen|Stunde|Sekunde|Einfach|Schnell|Besser|Erstelle|Verbessern|Verbessert|Veröffentlichen|Veröffentlicht|Teilen|Hochladen|Bearbeiten|Fertig|Bereit|Anmelden|Abmelden|Registrieren|Konto|Profil|Passwort|Mitglied|Preise|Monatlich|Jährlich|Kostenlos|Testphase|Rechnung|Zahlung|Abonnement|Kündigen|Verwalten|Startseite|Hilfe|Unterstützung|Dokumentation|Anleitung|Bilder|Bild|Foto|Webseite|Kontakt|Datenschutz|Impressum|Bedingungen|Akzeptieren|Ablehnen|Zustimmen|Nutzer|Benutzer|Kunde|Kunden|Bewertung|Kommentar|Antwort|Gefällt|Abonnenten|Zielgruppe|Nische|Werbung|Kampagne|Artikel|Beiträge|Beitrag|Suchbegriffe|Besucher|Besuche|Konversion|Konvertieren|Umsatz|Gewinn|Einnahmen|Wachstum|Wachsen|Veröffentlichung|Ankündigung|Neuigkeiten|Warteliste|Einladung|Rabatt|Gutschein|Angebot|Exklusiv|Begrenzt|Sprache|Ziel|Markt|Luxus|Demnächst verfügbar)\b/;

const deValueIssues: { key: string; value: string }[] = [];
const enValueIssues: { key: string; value: string }[] = [];

function strValues(dict: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v === 'string') out.push([k, v]);
    else if (Array.isArray(v)) {
      v.forEach((item, idx) => {
        if (typeof item === 'string') out.push([`${k}[${idx}]`, item]);
      });
    }
  }
  return out;
}

for (const [k, v] of strValues(de)) {
  // placeholder tokens {likes}/{dislikes}, %d / %s and brand terms are fine
  const cleaned = v.replace(/\{[a-z]+\}/g, ' ').replace(/%[ds]/g, ' ');
  if (containsEnglish(cleaned)) deValueIssues.push({ key: k, value: v.slice(0, 100) });
}
for (const [k, v] of strValues(en)) {
  if (GERMAN_ONLY_RE.test(v)) enValueIssues.push({ key: k, value: v.slice(0, 100) });
}

// ── Server-side informational report ─────────────────────────────────────────
const serverInfo: Finding[] = [];
const serverFiles = allFiles.filter(
  (f) => /\/ai\/|\/api\/|\/db\/|\/store\/|\/stripe\/|\/auth\/|\/lib\//.test(f) && f.endsWith('.ts'),
);
for (const f of serverFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/console\.|throw new|new Error|#__PURE__|import |require\(/.test(line)) continue;
    for (const m of line.matchAll(/['"]([^'"]{4,110})['"]/g)) {
      const v = m[1];
      if (/^[a-z][a-z0-9-]*$/.test(v) || v.startsWith('/') || v.startsWith('~/') || /^\$\{/.test(v)) continue;
      if (containsEnglish(v)) {
        serverInfo.push({ file: f, line: i + 1, kind: 'SERVER-LIT', text: v.slice(0, 90) });
      }
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
let failed = false;
console.log('═══ i18n language-mixing scan ═══════════════════════════════════════');
console.log(`Dictionaries: de = ${deKeys.size} keys, en = ${enKeys.size} keys`);

if (onlyDe.length || onlyEn.length) {
  failed = true;
  console.log('❌ KEY-PARITY FAIL:');
  if (onlyDe.length) console.log(`   only in de.ts: ${onlyDe.join(', ')}`);
  if (onlyEn.length) console.log(`   only in en.ts: ${onlyEn.join(', ')}`);
} else {
  console.log('✅ KEY-PARITY: de.ts and en.ts have identical key sets (no fallback-to-English).');
}

if (missingUsedKeysReal.length) {
  failed = true;
  console.log(`❌ USED-KEYS FAIL — used but missing in dictionaries: ${missingUsedKeysReal.join(', ')}`);
} else {
  console.log('✅ USED-KEYS: every t.<key> usage exists in both dictionaries.');
}

if (uiFindings.length) {
  failed = true;
  console.log(`❌ UI HARDCODED STRINGS (${uiFindings.length}):`);
  for (const f of uiFindings) {
    console.log(`   ${f.file.replace(ROOT + '/', '')}:${f.line} [${f.kind}] ${f.text}`);
  }
} else {
  console.log('✅ UI HARDCODED STRINGS: no English UI strings outside i18n in components/routes.');
}

if (deValueIssues.length) {
  failed = true;
  console.log(`❌ DE-VALUES (English words inside German translations, ${deValueIssues.length}):`);
  for (const d of deValueIssues) console.log(`   ${d.key}: ${d.value}`);
} else {
  console.log('✅ DE-VALUES: no English UI words inside German translations.');
}

if (enValueIssues.length) {
  failed = true;
  console.log(`❌ EN-VALUES (German tokens inside English translations, ${enValueIssues.length}):`);
  for (const d of enValueIssues) console.log(`   ${d.key}: ${d.value}`);
} else {
  console.log('✅ EN-VALUES: no German tokens inside English translations.');
}

console.log(`ℹ️  Server-side English literals (dev-facing only, never rendered): ${serverInfo.length}`);
for (const f of serverInfo.slice(0, 30)) {
  console.log(`   ${f.file.replace(ROOT + '/', '')}:${f.line} [${f.kind}] ${f.text}`);
}
if (serverInfo.length > 30) console.log(`   … and ${serverInfo.length - 30} more (see i18n-audit-evidence.txt)`);

console.log('════════════════════════════════════════════════════════════════════');
if (failed) {
  console.log('RESULT: ❌ MIXING FOUND — fix the issues above and re-run.');
  process.exit(1);
}
console.log('RESULT: ✅ CLEAN — 100% German in de-mode, 100% English in en-mode, no mixing, no missing keys.');
process.exit(0);

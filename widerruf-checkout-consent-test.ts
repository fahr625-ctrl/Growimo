// ─────────────────────────────────────────────────────────────────────────────
// WIDERRUF / VORZEITIGER BEGINN IM CHECKOUT — Test-Suite (ENTWURF 2026-10-24)
//   Owner-Entscheidungspunkt 1: Widerrufsrecht beim KI-SaaS-Abonnement.
//
// Usage (aus der Repo-Wurzel):
//   bun --env-file=.env widerruf-checkout-consent-test.ts
//
// Die Suite ist ABSICHTLICH ohne DB-Schreibzugriff (die Produktions-DB ist
// read-only) und ohne Stripe-Aufruf. Geprüft werden:
//   (a) Modus-Auflösung (fail-closed: Default = Zustimmung verlangt)
//   (b) reine Entscheidungslogik (nur echtes `true`, Versionsbindung)
//   (c) Nachweis-Datensatz (keine PII außer Konto/Zeit/Preis/Version)
//   (d) Quelltext-Assertions: Gate VOR dem Stripe-Call, Nachweis VOR der
//       Session, Checkbox im Frontend, Server-Prüfung nicht umgehbar
//   (e) i18n-Parität de/en + Wortlaut-Guards (keine pauschale
//       „erlischt automatisch"-Klausel)
//   (f) Schema: Tabelle checkout_consents vorhanden und idempotent
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import {
  WIDERRUF_CONSENT_KIND,
  WIDERRUF_CONSENT_REQUIRED_CODE,
  WIDERRUF_CONSENT_VERSION,
  WiderrufConsentError,
  assertEarlyStartConsent,
  buildConsentRecord,
  earlyStartMode,
  evaluateEarlyStartConsent,
  WIDERRUF_CONSENT_TEXT_DE,
  WIDERRUF_CONSENT_TEXT_EN,
  WIDERRUF_CONSENT_HINT_DE,
  WIDERRUF_CONSENT_HINT_EN,
} from './src/stripe/checkout-consent';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import { schemaSQL } from './src/db/schema';

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};
const read = (p: string) => readFileSync(p, 'utf8');

console.log('=== (a) Modus-Auflösung (fail-closed) ===');
check(earlyStartMode({}) === 'required', 'ohne Env → required (fail-closed)');
check(
  earlyStartMode({ WIDERRUF_EARLY_START: undefined }) === 'required',
  'undefined → required',
);
check(earlyStartMode({ WIDERRUF_EARLY_START: '' }) === 'required', 'leer → required');
check(
  earlyStartMode({ WIDERRUF_EARLY_START: 'off' }) === 'off',
  "'off' → off (Variante i)",
);
check(
  earlyStartMode({ WIDERRUF_EARLY_START: 'FALSE' }) === 'off',
  "'FALSE' → off (case-insensitiv)",
);
check(earlyStartMode({ WIDERRUF_EARLY_START: '0' }) === 'off', "'0' → off");
check(
  earlyStartMode({ WIDERRUF_EARLY_START: 'ja' }) === 'required',
  "unbekannter Wert 'ja' → required (nicht stillschweigend off)",
);

console.log('=== (b) Entscheidungslogik ===');
const d1 = evaluateEarlyStartConsent(undefined, 'required');
check(!d1.ok && d1.reason === 'consent_missing', 'ohne Input → consent_missing');
const d2 = evaluateEarlyStartConsent({ earlyStartConsent: 'true' }, 'required');
check(!d2.ok && d2.reason === 'consent_missing', "String 'true' zählt NICHT als Zustimmung");
const d3 = evaluateEarlyStartConsent({ earlyStartConsent: 1 }, 'required');
check(!d3.ok && d3.reason === 'consent_missing', 'Zahl 1 zählt NICHT als Zustimmung');
const d4 = evaluateEarlyStartConsent(
  { earlyStartConsent: true, consentVersion: WIDERRUF_CONSENT_VERSION },
  'required',
);
check(d4.ok && d4.reason === 'consented', 'true + aktuelle Version → Zustimmung gültig');
const d5 = evaluateEarlyStartConsent(
  { earlyStartConsent: true, consentVersion: '2026-01-01-v0' },
  'required',
);
check(
  !d5.ok && d5.reason === 'consent_version_mismatch',
  'veraltete Textversion → abgelehnt',
);
const d6 = evaluateEarlyStartConsent({ earlyStartConsent: true }, 'required');
check(!d6.ok && d6.reason === 'consent_version_mismatch', 'fehlende Version → abgelehnt');
const d7 = evaluateEarlyStartConsent(undefined, 'off');
check(d7.ok && d7.reason === 'mode_off', "Modus 'off' → kein Zwang (Variante i)");

let thrown: unknown = null;
try {
  assertEarlyStartConsent({ earlyStartConsent: false }, 'required');
} catch (err) {
  thrown = err;
}
check(
  thrown instanceof WiderrufConsentError &&
    (thrown as WiderrufConsentError).code === WIDERRUF_CONSENT_REQUIRED_CODE,
  `assert wirft WiderrufConsentError mit code '${WIDERRUF_CONSENT_REQUIRED_CODE}'`,
);

console.log('=== (c) Nachweis-Datensatz ===');
const rec = buildConsentRecord({
  clerkUserId: 'user_TEST_123',
  priceLookupKey: 'pro_monthly',
  acceptedAt: new Date('2026-10-24T08:00:00.000Z'),
});
check(rec.kind === WIDERRUF_CONSENT_KIND, `kind = '${WIDERRUF_CONSENT_KIND}'`);
check(rec.textVersion === WIDERRUF_CONSENT_VERSION, 'Textversion wird mitgeschrieben');
check(rec.acceptedAt === '2026-10-24T08:00:00.000Z', 'Zeitpunkt als ISO-String');
check(rec.priceLookupKey === 'pro_monthly', 'Preis wird mitgeschrieben');
check(
  Object.keys(rec).sort().join(',') ===
    ['acceptedAt', 'clerkUserId', 'kind', 'priceLookupKey', 'textVersion'].sort().join(','),
  'keine weiteren Felder (keine IP, kein User-Agent)',
);
let anonThrew = false;
try {
  buildConsentRecord({ clerkUserId: 'anonymous' });
} catch {
  anonThrew = true;
}
check(anonThrew, "buildConsentRecord lehnt 'anonymous' ab");

console.log('=== (d) Quelltext-Assertions (Einbau-Ort) ===');
const checkoutSrc = read('./src/stripe/checkout.ts');
const pricingSrc = read('./src/routes/app/pricing.tsx');
const subSrc = read('./src/stripe/subscription.ts');
const gateIdx = checkoutSrc.indexOf('assertEarlyStartConsent(');
const sessionIdx = checkoutSrc.indexOf('stripe.checkout.sessions.create(');
const insertIdx = checkoutSrc.indexOf('qInsertCheckoutConsent(');
check(gateIdx > 0, 'checkout.ts ruft assertEarlyStartConsent() auf');
check(
  gateIdx > 0 && sessionIdx > 0 && gateIdx < sessionIdx,
  'Gate steht VOR stripe.checkout.sessions.create (fail-closed)',
);
check(
  insertIdx > 0 && sessionIdx > 0 && insertIdx < sessionIdx,
  'Zustimmungs-Nachweis wird VOR der Session geschrieben',
);
check(
  /if \(!consentId\) \{\s*\n\s*throw new Error\(/.test(checkoutSrc),
  'fehlgeschlagener Nachweis bricht den Checkout ab (kein stiller Weiterlauf)',
);
check(
  checkoutSrc.includes('widerrufConsent: consent.required') &&
    checkoutSrc.includes('widerrufConsentVersion: consent.version'),
  'Zustand zusätzlich in den Stripe-Session-Metadaten',
);
check(
  pricingSrc.includes('consentRequired && !consentChecked'),
  'Frontend blockt ohne Zustimmung (nur Vorprüfung)',
);
check(
  pricingSrc.includes('earlyStartConsent: consentRequired ? consentChecked : false') &&
    pricingSrc.includes('consentVersion: WIDERRUF_CONSENT_VERSION'),
  'Frontend schickt Zustimmung + Textversion an den ServerFn',
);
check(
  pricingSrc.includes('type="checkbox"') && pricingSrc.includes('setConsentChecked'),
  'Checkbox existiert im Checkout-Formular',
);
check(
  pricingSrc.indexOf('{consentBlock}') > 0 &&
    pricingSrc.indexOf('{consentBlock}') < pricingSrc.indexOf('{userTier === \'pro\' ? ('),
  'Checkbox steht VOR dem Kauf-Button',
);
check(
  subSrc.includes('earlyStartConsentRequired: earlyStartMode()') &&
    subSrc.includes('earlyStartConsentRequired: boolean'),
  'Server meldet den Modus an die UI (eine Quelle: earlyStartMode())',
);
check(
  !pricingSrc.includes('WIDERRUF_EARLY_START'),
  'UI liest die Env NICHT direkt (kein Vite-Env-Leak, kein Auseinanderlaufen)',
);

// ── (d2) DRIFT-SCHUTZ: /app/billing hat DENSELBEN Upgrade-Pfad ───────────────
// Der zweite Checkout-Einstieg (Billing-Seite) muss identisch abgesichert sein.
// Ohne diese Checks könnte die Checkbox in pricing.tsx gepflegt werden, während
// /app/billing im Modus 'required' (Default, fail-closed) am ServerFn scheitert —
// der Nutzer sähe einen Fehler statt der Checkbox.
const billingSrc = read('./src/routes/app/billing.tsx');
const consentCallExpr = 'earlyStartConsent: consentRequired ? consentChecked : false';
check(
  billingSrc.includes("from '~/stripe/checkout-consent'") &&
    billingSrc.includes('WIDERRUF_CONSENT_VERSION'),
  'billing.tsx nutzt die kanonische Textversion (checkout-consent.ts)',
);
check(
  billingSrc.includes(consentCallExpr) &&
    billingSrc.includes('consentVersion: WIDERRUF_CONSENT_VERSION'),
  'billing.tsx schickt Zustimmung + Textversion an den ServerFn',
);
check(
  pricingSrc.includes(consentCallExpr),
  'beide Checkout-Einstiege nutzen DENSELBEN Ausdruck (Drift = rot)',
);
check(
  billingSrc.includes('consentRequired && !consentChecked') &&
    billingSrc.includes('setError(t.widerruf_consent_required)'),
  'billing.tsx blockt ohne Zustimmung mit sauberer Fehlermeldung',
);
check(
  billingSrc.includes('type="checkbox"') && billingSrc.includes('setConsentChecked'),
  'Checkbox existiert auch im Billing-Formular',
);
check(
  billingSrc.includes('t.widerruf_consent_label') &&
    billingSrc.includes('t.widerruf_consent_hint') &&
    pricingSrc.includes('t.widerruf_consent_label') &&
    pricingSrc.includes('t.widerruf_consent_hint'),
  'beide Einstiege rendern denselben kanonischen i18n-Wortlaut',
);
const billingConsentIdx = billingSrc.indexOf('{consentBlock}');
const billingUpgradeIdx = billingSrc.indexOf('onClick={handleUpgrade}');
check(
  billingConsentIdx > 0 && billingUpgradeIdx > 0 && billingConsentIdx < billingUpgradeIdx,
  'billing.tsx: Checkbox steht VOR dem Upgrade-Button',
);
check(
  billingSrc.includes('setConsentRequired(status.earlyStartConsentRequired)'),
  'billing.tsx holt den Modus vom Server (keine hartkodierte Annahme)',
);
check(
  !billingSrc.includes('WIDERRUF_EARLY_START'),
  'billing.tsx liest die Env NICHT direkt',
);
check(
  billingSrc.includes('widerruf_consent|Widerruf'),
  'billing.tsx übersetzt eine serverseitige Ablehnung in die Consent-Meldung',
);

console.log('=== (e) i18n-Parität + Wortlaut-Guards ===');
check(
  typeof de.widerruf_consent_label === 'string' && de.widerruf_consent_label.length > 40,
  'de: widerruf_consent_label vorhanden',
);
check(
  typeof en.widerruf_consent_label === 'string' && en.widerruf_consent_label.length > 40,
  'en: widerruf_consent_label vorhanden',
);
check(!!de.widerruf_consent_hint && !!en.widerruf_consent_hint, 'hint in beiden Sprachen');
check(
  !!de.widerruf_consent_required && !!en.widerruf_consent_required,
  'Fehlermeldung in beiden Sprachen',
);
const deKeys = Object.keys(de).length;
const enKeys = Object.keys(en).length;
check(deKeys === enKeys, `i18n-Parität: ${deKeys} de == ${enKeys} en`);
check(
  de.widerruf_consent_label.includes('ausdrücklich') &&
    de.widerruf_consent_label.includes('nicht schon mit dem Beginn erlischt') &&
    de.widerruf_consent_label.includes('vollständig erbracht ist') &&
    de.widerruf_consent_label.includes('§ 356 Abs. 4 und 5') &&
    de.widerruf_consent_label.includes('§ 357a Abs. 1 BGB'),
  'de-Label: Verlangen + Kenntnis (Erlöschen erst bei vollständiger Erbringung, Wertersatz)',
);
check(
  en.widerruf_consent_label.toLowerCase().includes('expressly') &&
    en.widerruf_consent_label.includes('does not end when the service begins') &&
    en.widerruf_consent_label.includes('fully performed') &&
    en.widerruf_consent_label.includes('357a(1)'),
  'en-Label: express request + acknowledgement (erasure only on full performance)',
);
check(
  de.widerruf_consent_hint.includes('§ 357a Abs. 1 BGB') &&
    de.widerruf_consent_hint.includes('vollständig erbracht'),
  'de-Hinweis: Monatsbezug + § 357a Abs. 1 BGB',
);
check(
  !/erlischt automatisch/i.test(de.widerruf_consent_label + de.widerruf_consent_hint) &&
    !/Widerrufsrecht verliere/i.test(de.widerruf_consent_label),
  'keine pauschale Erlöschens-/Verlust-Formel im Checkbox-Text (de)',
);
check(
  !/sofort|automatisch/i.test(en.widerruf_consent_label) &&
    !/lose my right of withdrawal/i.test(en.widerruf_consent_label),
  'en-Label ohne pauschale Erlöschens-Behauptung',
);
// EINE Textquelle: der Wortlaut steht kanonisch in checkout-consent.ts und wird
// hier byte-genau gegen die i18n-Fassungen geprüft. Driftet einer der beiden
// Texte, schlägt dieser Test fehl — der Owner sähe sonst eine andere Fassung
// als die, deren Textversion gespeichert wird.
check(
  de.widerruf_consent_label === WIDERRUF_CONSENT_TEXT_DE,
  'de-Label == kanonischer Wortlaut (checkout-consent.ts)',
);
check(
  en.widerruf_consent_label === WIDERRUF_CONSENT_TEXT_EN,
  'en-Label == kanonischer Wortlaut (checkout-consent.ts)',
);
check(
  de.widerruf_consent_hint === WIDERRUF_CONSENT_HINT_DE,
  'de-Hinweis == kanonischer Wortlaut',
);
check(
  en.widerruf_consent_hint === WIDERRUF_CONSENT_HINT_EN,
  'en-Hinweis == kanonischer Wortlaut',
);
check(
  de.widerruf_consent_label.length === en.widerruf_consent_label.length ||
    Math.abs(de.widerruf_consent_label.length - en.widerruf_consent_label.length) < 200,
  'de/en-Label in vergleichbarer Länge (Parität)',
);

console.log('=== (f) Schema: checkout_consents ===');
check(
  schemaSQL.includes('CREATE TABLE IF NOT EXISTS checkout_consents'),
  'Tabelle checkout_consents ist idempotent angelegt',
);
const statements = schemaSQL.split(';').map((s) => s.trim());
const consentStmt = statements.find((s) => s.includes('CREATE TABLE IF NOT EXISTS checkout_consents'));
check(!!consentStmt, 'Statement übersteht den ;-Split (init.ts) unbeschadet');
check(
  !!consentStmt &&
    consentStmt.includes('user_id TEXT NOT NULL') &&
    !consentStmt.includes('REFERENCES'),
  'user_id ist TEXT ohne Fremdschlüssel (Nachweis überlebt Konto-Löschung)',
);
check(
  !!consentStmt && !consentStmt.includes('ip') && !consentStmt.includes('user_agent'),
  'keine IP/User-Agent-Spalte (Datenminimierung)',
);
check(
  schemaSQL.includes('idx_checkout_consents_session'),
  'Unique-Index auf checkout_session_id',
);

console.log('');
console.log(`=== ERGEBNIS: ${passed} PASS, ${failed} FAIL ===`);
if (failed > 0) {
  console.log('Fehlgeschlagen:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log('Alle Checks grün.');

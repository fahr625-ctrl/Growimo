// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 (Stabilisierung) — Test-Suite: Markenprofil EIN/AUS + Nutzer-Vorrang
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):
//   bun brand-profile-test.ts
//
// Deckt Fix-Plan Phase 1 ab:
//   1.1 Schalter-Datenmodell  — enabled-Default, Alt-Profil ohne Feld = AKTIV,
//       setBrandProfileEnabled() persistiert OHNE das Profil zu löschen.
//   1.2 Nutzerinput-Vorrang  — Markenblock ist eigener additionalContext-Abschnitt
//       (NICHT mehr in productIdea geklebt) + globale Vorrang-Regel im
//       OpenAI-System-Prompt jedes Kanals.
//   1.3 TikTok               — harte Vorrang-Regel in den System-Prompts (de/en),
//       Markenblock als Stil-/Faktenrahmen, Selbsttest dämpft NICHT mehr gegen
//       das Nutzerthema (`userSubjectProvided`).
//   1.4 Draft/?idea=         — frische Nutzereingabe schlägt den Entwurf
//       (gemeinsame reine Funktion src/lib/idea-priority.ts).
//
// Kein DB-Zugriff: das Markenprofil lebt AUSSCHLIESSLICH im localStorage
// (store/brand.ts) — deshalb hier ein In-Memory-localStorage-Shim statt einer
// Neon-Test-DB. Es werden keine Nutzer-/Produktionsdaten berührt.
// Exit-Code 0 nur, wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { join } from 'path';

// ── localStorage-Shim MUSS vor dem Import der Store-Module stehen ────────────
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

// Aus der Repo-Wurzel gestartet (siehe Usage oben) — deshalb cwd statt import.meta.dir
// (letzteres ist in der tsconfig dieses Projekts nicht typisiert).
const ROOT = process.cwd();

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

const STORAGE_KEY = 'growimo_brand_profile';

/** Ein realistisches „Growimo"-Markenprofil (Bestandsprofil VOR Phase 1, ohne `enabled`). */
const LEGACY_PROFILE = {
  brandName: 'Growimo',
  website: 'growimo.app',
  tagline: 'Built for Growth',
  tone: 'direkt, konkret',
  targetAudience: 'Creator und kleine Unternehmen',
  uniqueSellingPoint: 'Marketing-Entscheidungen statt nur Text',
  offerings: 'KI-Marketing-Entscheidungsengine',
  mainGoal: 'Beta-Nutzer zu zahlenden Pro-Nutzern machen',
  statusChallenge: 'Beta gestartet, aber kaum Tester',
  brandColors: 'Blau',
  competitors: 'ChatGPT',
  products: ['Content-Engine'],
  avoidTopics: '',
  neverClaim: 'keine erfundenen Nutzerzahlen',
  brandVoice: 'klar und ehrlich',
  lastUpdated: '2026-09-01T00:00:00.000Z',
  // bewusst KEIN `enabled` — so sieht ein Alt-Profil aus
};

async function main() {
  console.log('— brand-profile-test (Phase 1) —\n');
  const brand = await import(join(ROOT, 'src/store/brand.ts'));
  const openai = await import(join(ROOT, 'src/ai/providers/openai.ts'));
  const tiktok = await import(join(ROOT, 'src/ai/tiktok.ts'));
  const { resolveInitialIdea } = await import(join(ROOT, 'src/lib/idea-priority.ts'));

  // ── 1.1 Schalter-Datenmodell ───────────────────────────────────────────────
  console.log('\n[1.1] Schalter-Datenmodell (enabled)');
  check(brand.normalizeBrandProfile({}).enabled === true, 'normalizeBrandProfile({}) → enabled=true (Default)');
  check(
    brand.normalizeBrandProfile({ brandName: 'X' } as never).enabled === true,
    'Alt-Profil ohne Feld → enabled=true (Bestandsverhalten unverändert)',
  );
  check(
    brand.normalizeBrandProfile({ brandName: 'X', enabled: false } as never).enabled === false,
    'enabled=false bleibt false (normalize überschreibt nicht)',
  );
  check(
    brand.normalizeBrandProfile({ enabled: true } as never).enabled === true,
    'enabled=true bleibt true',
  );

  // ── Alt-Profil aus dem Storage (Bestandsnutzer) ────────────────────────────
  console.log('\n[1.1] Bestandsprofil ohne enabled-Feld (localStorage)');
  storage.setItem(STORAGE_KEY, JSON.stringify(LEGACY_PROFILE));
  const legacy = brand.getBrandProfile();
  check(legacy !== null, 'Alt-Profil lädt weiterhin (kein null)');
  check(legacy?.enabled === true, 'Alt-Profil ist AKTIV (enabled !== false)');
  check(brand.isBrandProfileEnabled() === true, 'isBrandProfileEnabled() → true');
  check(brand.isBrandProfileComplete(legacy) === true, 'isBrandProfileComplete(Alt-Profil) → true');
  check(brand.hasBrandProfile() === true, 'hasBrandProfile() → true');
  const legacyCtx = brand.getBrandContext();
  check(legacyCtx.length > 0, 'getBrandContext() liefert Kontext (Alt-Profil unverändert nutzbar)');
  check(legacyCtx.includes('MARKENKONTEXT'), 'Kontext enthält MARKENKONTEXT-Block');
  check(legacyCtx.includes('Growimo') && legacyCtx.includes('growimo.app'), 'Kontext enthält Markenname/Website');

  // ── 1.2 Vorrang-Regel im Markenblock ───────────────────────────────────────
  console.log('\n[1.2] Vorrang-Regel im Markenblock');
  check(legacyCtx.includes('VORRANG-REGEL'), 'Markenblock enthält VORRANG-REGEL');
  check(legacyCtx.includes('AUS DER NUTZEREINGABE'), 'Regel: Inhalt kommt aus der Nutzereingabe');
  check(
    legacyCtx.includes('kleines Café') && legacyCtx.includes('Weihnachts-Pin'),
    'Regel nennt konkrete Beispiele (kleines Café, Weihnachts-Pin)',
  );
  check(legacyCtx.includes('NIEMALS'), 'Regel verbietet das Überschreiben hart (NIEMALS)');
  check(
    !legacyCtx.includes('authoritative Faktenbasis'),
    'alte Formulierung „authoritative Faktenbasis" ist entfernt (C2)',
  );
  check(legacyCtx.startsWith('MARKENKONTEXT'), 'Block beginnt mit MARKENKONTEXT-Header');

  // ── 1.1 AUS schalten: Profil bleibt gespeichert ────────────────────────────
  console.log('\n[1.1] AUS schalten — Profil bleibt gespeichert');
  brand.setBrandProfileEnabled(false);
  const rawAfterOff = storage.getItem(STORAGE_KEY);
  check(!!rawAfterOff, 'Profil wurde NICHT gelöscht (Storage-Key existiert weiter)');
  check(!!rawAfterOff && rawAfterOff.includes('Growimo'), 'Markenname steht weiterhin im gespeicherten Profil');
  check(!!rawAfterOff && JSON.parse(rawAfterOff).enabled === false, 'enabled=false ist persistiert');
  const offProfile = brand.getBrandProfile();
  check(offProfile?.brandName === 'Growimo', 'Daten unverändert (brandName bleibt Growimo)');
  check(offProfile?.website === 'growimo.app', 'Daten unverändert (website bleibt growimo.app)');
  check(offProfile?.offerings === LEGACY_PROFILE.offerings, 'Daten unverändert (offerings erhalten)');
  check(brand.isBrandProfileEnabled() === false, 'isBrandProfileEnabled() → false');
  check(brand.isBrandProfileComplete(offProfile) === false, 'AUS ⇒ isBrandProfileComplete() false');
  check(brand.hasBrandProfile() === true, 'AUS ⇒ hasBrandProfile() bleibt true (Profil existiert)');
  check(brand.getBrandContext() === '', 'AUS ⇒ getBrandContext() === "" (nichts wird geliefert)');

  // ── 1.1 wieder EIN schalten: alles zurück, kein Datenverlust ───────────────
  console.log('\n[1.1] Wieder EIN schalten (idempotent, kein Datenverlust)');
  brand.setBrandProfileEnabled(true);
  const onCtx = brand.getBrandContext();
  check(onCtx.length > 0, 'EIN ⇒ getBrandContext() liefert wieder Kontext');
  check(onCtx.includes('growimo.app'), 'EIN ⇒ Website wieder im Kontext (kein Datenverlust)');
  check(brand.isBrandProfileEnabled() === true, 'isBrandProfileEnabled() → true');
  check(
    brand.isBrandProfileComplete(brand.getBrandProfile()) === true,
    'isBrandProfileComplete() → true nach dem Wiedereinschalten',
  );

  // ── 1.1 kein Profil ⇒ nichts zu schalten ──────────────────────────────────
  console.log('\n[1.1] Ohne Profil (kein Storage-Eintrag)');
  brand.clearBrandProfile();
  check(brand.getBrandProfile() === null, 'kein Profil ⇒ getBrandProfile() null');
  check(brand.isBrandProfileEnabled() === false, 'kein Profil ⇒ isBrandProfileEnabled() false');
  check(brand.getBrandContext() === '', 'kein Profil ⇒ getBrandContext() ""');
  brand.setBrandProfileEnabled(true);
  check(storage.getItem(STORAGE_KEY) === null, 'setBrandProfileEnabled ohne Profil legt KEINEN Eintrag an (no-op)');
  check(brand.getBrandProfile() === null, 'setBrandProfileEnabled ohne Profil ändert nichts');

  // ── 1.2 Kanal-Prompt: Markenblock NICHT mehr in der Produktidee ────────────
  console.log('\n[1.2] Kanal-Prompt (openai.ts) — Nutzereingabe bleibt das Thema');
  storage.setItem(STORAGE_KEY, JSON.stringify(LEGACY_PROFILE)); // Profil EIN, Marke Growimo
  const ctx = brand.getBrandContext();
  const idea = 'kleines Café in Hamburg mit selbstgebackenem Kuchen';
  const prompt = openai.buildUserPrompt({
    contentType: 'pinterest_pin',
    productIdea: idea,
    additionalContext: ctx,
  } as never);
  const firstLine = prompt.split('\n')[0];
  check(firstLine === `Produktidee: ${idea}`, 'erste Zeile = rohe Nutzeridee (kein Markenblock davor)');
  check(!firstLine.includes('MARKENKONTEXT'), 'Produktidee-Zeile enthält KEINEN Markenblock mehr (C1)');
  check(prompt.startsWith(`Produktidee: ${idea}`), 'Prompt beginnt mit der Nutzereingabe');
  check(prompt.includes('Produktdetails:'), 'Markenblock liegt im eigenen Abschnitt „Produktdetails"');
  check(
    prompt.indexOf('Produktdetails:') > prompt.indexOf(idea),
    'Markenblock kommt NACH der Nutzeridee (Rahmen, nicht Gegenstand)',
  );
  check(prompt.includes('VORRANG-REGEL'), 'Vorrang-Regel ist im Prompt enthalten');
  check(prompt.includes('Antworte vollständig auf Deutsch.'), 'deutsche Ausgabe weiterhin erzwungen');
  check(
    prompt.split('Antworte vollständig auf Deutsch.').length - 1 === 1,
    'deutsche Ausgabe wird nur EINMAL angehängt (Refactoring-Regression)',
  );
  const sysPrompt = openai.buildSystemPrompt('pinterest_pin');
  check(sysPrompt.includes('VORRANG DER NUTZEREINGABE'), 'System-Prompt enthält die harte Vorrang-Regel');
  check(sysPrompt.includes('kleines Café'), 'System-Prompt nennt das Nutzerthema-Beispiel');
  check(
    sysPrompt.includes('EN: The user\'s "Produktidee" alone defines the topic'),
    'System-Prompt enthält auch die EN-Fassung der Regel',
  );
  const channelTypes = [
    'pinterest_pin',
    'etsy_listing',
    'seo_blog',
    'social_post',
    'newsletter',
    'product_description',
    'marketing_analysis',
    'market_intelligence',
  ];
  const withRule = channelTypes.filter((c) =>
    openai.buildSystemPrompt(c as never).includes('VORRANG DER NUTZEREINGABE'),
  ).length;
  check(
    withRule === channelTypes.length,
    `Vorrang-Regel gilt in ALLEN ${channelTypes.length} geprüften Kanälen (gefunden: ${withRule})`,
  );

  // ── 1.3 TikTok: Vorrang-Regel in den System-Prompts (de/en) ────────────────
  console.log('\n[1.3] TikTok — Vorrang-Regel + Markenblock als Rahmen');
  const conceptDe = tiktok.pickSystemPrompt('concept', 'de');
  const conceptEn = tiktok.pickSystemPrompt('concept', 'en');
  const todayDe = tiktok.pickSystemPrompt('todayIdea', 'de');
  const todayEn = tiktok.pickSystemPrompt('todayIdea', 'en');
  check(conceptDe.includes('VORRANG DER NUTZEREINGABE'), 'concept/DE enthält die harte Vorrang-Regel');
  check(conceptDe.includes('kleines Café'), 'concept/DE nennt das Nutzerthema-Beispiel');
  check(
    conceptDe.includes('NIEMALS in Marketing für das eigene Produkt um'),
    'concept/DE verbietet die Umdeutung in Marken-Marketing',
  );
  check(conceptEn.includes("PRIORITY OF THE USER'S OWN INPUT"), 'concept/EN enthält die harte Vorrang-Regel');
  check(conceptEn.includes('small café'), 'concept/EN nennt das Nutzerthema-Beispiel');
  check(todayDe.includes('VORRANG DER NUTZEREINGABE'), 'todayIdea/DE enthält die Vorrang-Regel ebenfalls');
  check(todayEn.includes("PRIORITY OF THE USER'S OWN INPUT"), 'todayIdea/EN enthält die Vorrang-Regel ebenfalls');
  const tiktokUserPrompt = tiktok.buildUserPrompt(
    {
      mode: 'concept',
      biz: '',
      brandContext: ctx,
      topic: 'kleines Café in Hamburg',
      goal: 'Reichweite',
    } as never,
    'de',
  );
  check(tiktokUserPrompt.includes('kleines Café in Hamburg'), 'TikTok-User-Prompt enthält das Nutzerthema');
  check(
    tiktokUserPrompt.includes('Stil- und Faktenrahmen') &&
      !tiktokUserPrompt.includes('authoritative Faktenbasis'),
    'TikTok-Markenblock ist als Stil-/Faktenrahmen gelabelt (C2)',
  );

  // ── 1.3 Selbsttest dämpft NICHT gegen das Nutzerthema ─────────────────────
  console.log('\n[1.3] TikTok — Selbsttest: kein Retry gegen das Nutzerthema');
  const cleanNoBrandFact = {
    usesConcreteBrandFact: false,
    addressesCurrentChallenge: true,
    interchangeable: false,
    soundsLikeAd: false,
    inventsUserOrTestimonial: false,
    unprovenPerformancePromise: false,
    prescribedEnthusiasm: false,
  };
  check(
    tiktok.selfCheckSuspiciousCount(cleanNoBrandFact as never, { userSubjectProvided: true }) === 0,
    'Nutzerthema vorhanden ⇒ „keine Markenfakt" zählt NICHT als Mangel',
  );
  check(
    tiktok.selfCheckSuspiciousCount(cleanNoBrandFact as never, {}) === 1,
    'ohne Nutzerthema ⇒ „keine Markenfakt" zählt weiterhin als Mangel',
  );
  check(
    tiktok.selfCheckRejected(cleanNoBrandFact as never, { userSubjectProvided: true }) === false,
    'Nutzerthema ⇒ Selbsttest verwirft die Idee NICHT (kein Anti-Nutzerthema-Retry)',
  );
  check(
    tiktok.selfCheckRejected(
      { ...cleanNoBrandFact, interchangeable: true } as never,
      { userSubjectProvided: true },
    ) === true,
    'austauschbare Idee bleibt HARD REJECT (auch mit Nutzerthema)',
  );
  check(
    tiktok.selfCheckRejected(
      { ...cleanNoBrandFact, inventsUserOrTestimonial: true } as never,
      { userSubjectProvided: true },
    ) === true,
    'erfundenes Testimonial bleibt HARD REJECT (auch mit Nutzerthema)',
  );
  check(
    tiktok.selfCheckRejected(
      { ...cleanNoBrandFact, unprovenPerformancePromise: true } as never,
      { userSubjectProvided: true },
    ) === true,
    'unbelegtes Leistungsversprechen bleibt HARD REJECT',
  );

  // ── 1.4 Draft/?idea=-Priorität ────────────────────────────────────────────
  console.log('\n[1.4] Draft vs. ?idea= — Priorität');
  const r1 = resolveInitialIdea('kleines Café', 'Growimo Beta-Draft');
  check(r1.idea === 'kleines Café', '?idea= schlägt den Entwurf (Feld zeigt „kleines Café")');
  check(r1.overriddenDraft === 'Growimo Beta-Draft', 'verdrängter Entwurf wird für den Hinweis zurückgegeben');
  const r2 = resolveInitialIdea(undefined, 'Growimo Beta-Draft');
  check(r2.idea === 'Growimo Beta-Draft', 'ohne ?idea= greift der Entwurf (Bestandsverhalten)');
  check(r2.overriddenDraft === null, 'ohne ?idea= kein Hinweis');
  const r3 = resolveInitialIdea('Café', 'Café');
  check(r3.idea === 'Café' && r3.overriddenDraft === null, 'identischer Entwurf ⇒ kein unnötiger Hinweis');
  const r4 = resolveInitialIdea('  Café  ', null);
  check(r4.idea === 'Café', '?idea= wird getrimmt');
  const r5 = resolveInitialIdea('', '');
  check(r5.idea === '' && r5.overriddenDraft === null, 'leere Eingaben ⇒ leeres Feld, kein Hinweis');
  const r6 = resolveInitialIdea('   ', 'Entwurf');
  check(r6.idea === 'Entwurf', 'leeres/whitespace ?idea= verdrängt den Entwurf NICHT');

  // ── Verdrahtung (Quelltext-Gates) ─────────────────────────────────────────
  console.log('\n[Verdrahtung] UI-Verbraucher nutzen die geprüften Pfade');
  const quick = readFileSync(join(ROOT, 'src/components/QuickGenerator.tsx'), 'utf8');
  const pkg = readFileSync(join(ROOT, 'src/routes/app/package.tsx'), 'utf8');
  const tikUi = readFileSync(join(ROOT, 'src/routes/app/tiktok.tsx'), 'utf8');
  const brandUi = readFileSync(join(ROOT, 'src/routes/app/brand.tsx'), 'utf8');
  const toggle = readFileSync(join(ROOT, 'src/components/BrandProfileToggle.tsx'), 'utf8');
  check(quick.includes('resolveInitialIdea('), 'QuickGenerator nutzt resolveInitialIdea (C3)');
  check(pkg.includes('resolveInitialIdea('), 'package.tsx nutzt resolveInitialIdea (C3)');
  check(
    quick.includes('additionalContext: [brandContext,') ||
      /additionalContext:\s*\[brandContext/.test(quick),
    'QuickGenerator legt den Markenblock in additionalContext (nicht in productIdea)',
  );
  check(!/productIdea:\s*brandCtx|productIdea:\s*enhancedIdea/.test(quick), 'QuickGenerator klebt den Markenblock NICHT mehr in productIdea');
  check(tikUi.includes('BrandProfileToggle'), 'TikTok-Werkstatt zeigt den EIN/AUS-Schalter');
  check(tikUi.includes('usableBrandProfile'), 'TikTok nutzt bei AUS kein Markenprofil (usableBrandProfile)');
  check(brandUi.includes('BrandProfileToggle'), 'Marken-Seite zeigt den EIN/AUS-Schalter');
  check(toggle.includes('data-enabled'), 'Schalter-Zustand ist über data-enabled testbar');
  check(toggle.includes('setBrandProfileEnabled'), 'Schalter persistiert über setBrandProfileEnabled (kein Löschen)');

  console.log(`\n=== brand-profile-test: ${passed} PASS, ${failed} FAIL ===`);
  if (failed > 0) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

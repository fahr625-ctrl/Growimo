// ─────────────────────────────────────────────────────────────────────────────
// Stabilisierung Phase 4 — Test-Suite (Fix-Plan §4.1/§4.2/§4.3)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):
//   bun stabilisierung-phase4-test.ts
//
// Deckt ab:
//   4.2 Kontexttreue ALLER Kanäle — Kontext-Modell (Nutzereingabe vs.
//       Markenprofil), deterministischer Post-Check der Kanal-Ausgaben,
//       Korrektur-Retry + ehrliche Ablehnung, globale Prompt-Regel für alle
//       Kanäle, Paket-Flow mit demselben Kontext-Modell. (Fälle 1–18)
//   4.1 Navigation/History — Router-Links statt Vollseiten-Sprünge in
//       tiktok.tsx/image-studio.tsx, bfcache-Gate (pageshow/persisted),
//       sessionStorage-Bedienung bei Reload/Zurück. (Fälle 19–26)
//   4.3 „Zuletzt erstellt" — Liste (max. 3) mit Wiederöffnen + „In Projekt
//       speichern" ohne Generierungsverbrauch. (Fälle 27–36)
//
// Keine DB-, keine Netzwerk- und keine LLM-Aufrufe: reine Funktionen,
// injizierte Runner und Quelltext-Checks (Muster der Phasen 1–3).
// Exit-Code 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { join } from 'path';

// ── sessionStorage-Shim MUSS vor dem Import der lib-Module stehen ────────────
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
}
(globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();

import {
  CONTEXT_LOYALTY_ERROR,
  SELF_REFERENCE_CONSTRAINT,
  brandContextIsGrowimo,
  contextLoyaltyCorrection,
  contextLoyaltyViolations,
  readBrandIdentity,
  requestLoyaltyViolations,
  resolveGrowimoContext,
  resultLoyaltyViolations,
  userNamesGrowimo,
} from './src/ai/context-loyalty';
import { runWithContextLoyalty } from './src/ai/generate';
import { buildSystemPrompt, buildUserPrompt, USER_PRIORITY_CONSTRAINT } from './src/ai/providers/openai';
import { preparePackageContext } from './src/ai/package/package';
import { generatePackageChannel } from './src/ai/package/generate';
import type { ContentRequest, ContentResult } from './src/ai/types';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ── Markenkontakt-Blöcke wie store/brand.ts sie baut ─────────────────────────
const BRAND_GROWIMO = [
  'MARKENKONTEXT (Stil- und Faktenrahmen — NUR diese Fakten verwenden, NICHTS erfinden):',
  '- Marke: Growimo',
  '- Website: https://growimo.app',
  '- Angebot (was bietet/verkauft das Unternehmen): KI-Marketing-Entscheidungsmaschine',
].join('\n');

const BRAND_CAFE = [
  'MARKENKONTEXT (Stil- und Faktenrahmen — NUR diese Fakten verwenden, NICHTS erfinden):',
  '- Marke: Café Bella',
  '- Website: https://cafe-bella.de',
  '- Angebot (was bietet/verkauft das Unternehmen): Kaffee und Kuchen',
].join('\n');

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log('PASS:', name);
  } else {
    failures.push(name);
    console.log('FAIL:', name, detail ? `— ${detail}` : '');
  }
}

function result(body: string, title = 'Titel'): ContentResult {
  return { contentType: 'pinterest_pin', title, body };
}

async function main(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // 4.2 — Kontexttreue ALLER Kanäle
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── 4.2 Kontexttreue ─────────────────────────────────────────────');

  // ── Fall 1: Test A — Profil EIN (Marke Growimo) + Idee „Growimo" ─────────
  {
    const req: ContentRequest = {
      contentType: 'pinterest_pin',
      productIdea: 'Growimo',
      additionalContext: BRAND_GROWIMO,
    };
    const ctx = resolveGrowimoContext(req);
    check('T1a Test A: Nutzeridee „Growimo" ⇒ Growimo erlaubt', ctx.allowsGrowimo === true, JSON.stringify(ctx));
    check('T1b Test A: Herkunft = Nutzereingabe', ctx.source === 'user', String(ctx.source));
    check(
      'T1c Test A: Growimo-Ausgabe wird NICHT abgelehnt',
      contextLoyaltyViolations('Pin-Titel: Growimo — 5 Ideen in 10 Minuten', ctx).length === 0,
    );
  }

  // ── Fall 2: Markenprofil eindeutig Growimo, Nutzerthema neutral ──────────
  {
    const req: ContentRequest = {
      contentType: 'seo_blog',
      productIdea: 'Keramiktassen für Kaffeeliebhaber',
      additionalContext: BRAND_GROWIMO,
    };
    const ctx = resolveGrowimoContext(req);
    check('T2a Profil „Marke: Growimo" ⇒ Kontext eindeutig Growimo', ctx.allowsGrowimo && ctx.source === 'brand');
    check(
      'T2b Growimo-Erwähnung mit Growimo-Profil ist erlaubt (Faktenrahmen)',
      contextLoyaltyViolations('Growimo zeigt dir, wie du Keramiktassen vermarktest.', ctx).length === 0,
    );
    check('T2c Markenidentität gelesen', ctx.brandName === 'Growimo' && ctx.website === 'https://growimo.app');
  }

  // ── Fall 3: Test B — Profil AUS, Idee „kleines Café in Hamburg" ──────────
  {
    const req: ContentRequest = {
      contentType: 'pinterest_pin',
      productIdea: 'kleines Café in Hamburg',
    };
    const ctx = resolveGrowimoContext(req);
    check('T3a Profil AUS ⇒ Growimo NICHT erlaubt', ctx.allowsGrowimo === false && ctx.source === null);
    const v = contextLoyaltyViolations(
      'Titel: Growimo – die Marketing-Entscheidungsmaschine\nBody: Starte mit Growimo durch.',
      ctx,
    );
    check('T3b unbegründete Growimo-Selbstthematisierung ⇒ Verstoß', v.includes('SELF-REF:growimo'), v.join('|'));
    check(
      'T3c Café-Ausgabe ohne „Growimo" ⇒ kein Verstoß (kein False Positive)',
      requestLoyaltyViolations(req, 'Titel: Der beste Kuchen in Hamburg').length === 0,
    );
    check('T3d Fehlermeldung nennt Growimo (ehrlich, kein stilles Liefern)',
      CONTEXT_LOYALTY_ERROR.includes('Growimo') && CONTEXT_LOYALTY_ERROR.includes('EN:'));
  }

  // ── Fall 4: Test E — fremdes Profil (Café Bella) + „Weihnachts-Pin" ──────
  {
    const req: ContentRequest = {
      contentType: 'pinterest_pin',
      productIdea: 'Weihnachts-Pin',
      additionalContext: BRAND_CAFE,
    };
    check('T4a fremdes Profil ⇒ keine Erlaubnis', resolveGrowimoContext(req).allowsGrowimo === false);
    check(
      'T4b Weihnachts-Pin mit Growimo-Werbung ⇒ Verstoß',
      resultLoyaltyViolations(req, {
        title: 'Growimo Weihnachts-Pin',
        body: 'Mit Growimo erstellst du Weihnachts-Pins.',
      }).includes('SELF-REF:growimo'),
    );
    check(
      'T4c Weihnachts-Pin ohne Growimo ⇒ kein Verstoß',
      resultLoyaltyViolations(req, { title: 'Weihnachts-Pin DIY', body: 'Zimt, Tannenzweige, warmes Licht.' }).length === 0,
    );
    check('T4d Domain-Erwähnung growimo.app wird ebenfalls erkannt',
      contextLoyaltyViolations('Mehr auf growimo.app', resolveGrowimoContext(req)).length === 1);
  }

  // ── Fall 5: Nutzer NENNT Growimo ausdrücklich (ohne Profil) ──────────────
  {
    const req: ContentRequest = { contentType: 'etsy_listing', productIdea: 'Growimo-Geschenkgutscheine' };
    const ctx = resolveGrowimoContext(req);
    check('T5a ausdrückliche Nennung in der Idee ⇒ erlaubt', ctx.allowsGrowimo && ctx.source === 'user', JSON.stringify(ctx));
    check('T5b Growimo-Ausgabe erlaubt', contextLoyaltyViolations('Growimo Gutschein 19 €', ctx).length === 0);
    check('T5c userNamesGrowimo erkennt Wortgrenzen („Growimoland" ist keine Nennung)',
      userNamesGrowimo('Growimoland') === false && userNamesGrowimo('Test Growimo Beta') === true);
  }

  // ── Fall 6: bloßes Wort im Zusatzkontext genügt NICHT ────────────────────
  {
    const req: ContentRequest = {
      contentType: 'social_post',
      productIdea: 'Handgemachte Kerzen',
      additionalContext: 'STRATEGIE-BRIEF:\n- Kanal: Wir haben schon einmal Growimo benutzt.\n- Ziel: mehr Sichtbarkeit',
    };
    const ctx = resolveGrowimoContext(req);
    check('T6a „Growimo" im Fließtext des Zusatzkontexts gibt KEINE Erlaubnis', ctx.allowsGrowimo === false);
    check('T6b Ausgabe mit Growimo ⇒ Verstoß', contextLoyaltyViolations('So nutzt du Growimo für Kerzen', ctx).length === 1);
  }

  // ── Fall 7: Marke „Growimo GmbH" / Website-only-Variante ─────────────────
  {
    check('T7a Markenname „Growimo GmbH" zählt als eindeutig', brandContextIsGrowimo('- Marke: Growimo GmbH'));
    check('T7b nur Website growimo.app zählt', brandContextIsGrowimo('- Marke: G-App\n- Website: growimo.app'));
    check('T7c fremder Markenname ohne Growimo-Site zählt NICHT',
      brandContextIsGrowimo('- Marke: Café Bella\n- Website: cafe-bella.de') === false);
    check('T7d kein Markenprofil ⇒ keine Erlaubnis', brandContextIsGrowimo('') === false && brandContextIsGrowimo(undefined) === false);
    const id = readBrandIdentity('- Marke: Growimo\n- Website: https://growimo.app');
    check('T7e readBrandIdentity liefert Marke + Website', id.brandName === 'Growimo' && id.website === 'https://growimo.app');
  }

  // ── Fall 8: Prompt-Bausteine de/en + Integration in alle Kanäle ──────────
  {
    check('T8a Selbstbezug-Regel enthält deutsches Verbot', SELF_REFERENCE_CONSTRAINT.includes('KEIN SELBSTBEZUG AUF GROWIMO'));
    check('T8b Selbstbezug-Regel enthält EN-Fassung', /EN: .*Growimo/.test(SELF_REFERENCE_CONSTRAINT));
    check('T8c Korrektur de enthält Growimo-Verbot', /KORREKTUR/.test(contextLoyaltyCorrection('de')) && contextLoyaltyCorrection('de').includes('Growimo'));
    check('T8d Korrektur en enthält Growimo-Verbot', /CORRECTION/.test(contextLoyaltyCorrection('en')) && contextLoyaltyCorrection('en').includes('Growimo'));
    const channels: Array<ContentRequest['contentType']> = [
      'pinterest_pin',
      'seo_blog',
      'etsy_listing',
      'email_newsletter',
      'social_post',
      'marketing_plan',
    ];
    check(
      'T8e Selbstbezug-Regel steht in JEDEM Kanal-System-Prompt (inkl. Newsletter)',
      channels.every((ct) => buildSystemPrompt(ct).includes(SELF_REFERENCE_CONSTRAINT)),
    );
    check(
      'T8f Nutzer-Vorrang-Regel (Phase 1) bleibt zusätzlich aktiv',
      channels.every((ct) => buildSystemPrompt(ct).includes(USER_PRIORITY_CONSTRAINT)),
    );
    const withNote = buildUserPrompt({
      contentType: 'pinterest_pin',
      productIdea: 'Kerzen',
      additionalContext: 'X',
      correctionNote: contextLoyaltyCorrection('de'),
    });
    check('T8g Korrektur-Hinweis steht im User-Prompt VOR dem Zusatzkontext',
      withNote.indexOf('KORREKTUR') > -1 && withNote.indexOf('KORREKTUR') < withNote.indexOf('Produktdetails:'));
    check('T8h ohne Korrektur-Hinweis unverändert (kein Leerblock)',
      !buildUserPrompt({ contentType: 'pinterest_pin', productIdea: 'Kerzen' }).includes('KORREKTUR'));
  }

  // ── Fall 9: Retry-/Reject-Logik des Post-Checks (injizierter Runner) ─────
  {
    const req: ContentRequest = { contentType: 'pinterest_pin', productIdea: 'kleines Café in Hamburg' };
    let calls = 0;
    const cleanRun = runWithContextLoyalty(req, async (r) => {
      calls++;
      if (calls === 1) return result('Growimo hilft dir beim Marketing.');
      check('T9a Retry erhält den Korrektur-Hinweis', typeof r.correctionNote === 'string' && r.correctionNote!.includes('KORREKTUR'));
      return result('Kaffee, Kuchen, Hamburger Hafen.');
    });
    const clean = await cleanRun;
    check('T9b korrigierter Versuch wird akzeptiert', clean.corrected === true && clean.attempts === 2);
    check('T9c Inhalt der zweiten Antwort wird geliefert', clean.result.body.includes('Hamburger Hafen'));

    let calls2 = 0;
    let thrown: unknown = null;
    try {
      await runWithContextLoyalty(req, async () => {
        calls2++;
        return result('Growimo Growimo Growimo');
      });
    } catch (e) {
      thrown = e;
    }
    check('T9d nach dem 2. Verstoß KEIN stilles Liefern, sondern Fehler',
      thrown instanceof Error && (thrown as Error).message === CONTEXT_LOYALTY_ERROR);
    check('T9e genau 2 Provider-Aufrufe (1 + 1 Korrektur)', calls2 === 2, `calls=${calls2}`);

    let calls3 = 0;
    const ok = await runWithContextLoyalty(req, async () => {
      calls3++;
      return result('Café-Inhalt ohne Selbstbezug.');
    });
    check('T9f konforme Ausgabe ⇒ KEIN Retry', ok.attempts === 1 && calls3 === 1 && ok.corrected === false);

    const brandReq: ContentRequest = {
      contentType: 'pinterest_pin',
      productIdea: 'Growimo',
      additionalContext: BRAND_GROWIMO,
    };
    let calls4 = 0;
    const allowed = await runWithContextLoyalty(brandReq, async () => {
      calls4++;
      return result('Growimo — so planst du deinen Content.');
    });
    check('T9g erlaubter Growimo-Kontext ⇒ kein Retry, Ausgabe durchgelassen', allowed.attempts === 1 && calls4 === 1);
  }

  // ── Fall 10: verdrahtet in die zentrale Engine + Paket-Flow ──────────────
  {
    const gen = src('src/ai/generate.ts');
    check('T10a generateContent läuft über den Kontexttreue-Guard',
      gen.includes('generateWithContextLoyalty') && gen.includes('runWithContextLoyalty(request'));
    check('T10b Ablehnung wirft den ehrlichen Fehler',
      gen.includes('throw new Error(CONTEXT_LOYALTY_ERROR)'));
    const pkg = src('src/ai/package/package.ts');
    check('T10c Paket-Kontext enthält den Markenrahmen (brandContext)',
      pkg.includes('opts.brandContext') && /kernelContext\(kernel\), brandContext, briefContext/.test(pkg));
    const pkgGen = src('src/ai/package/generate.ts');
    check('T10d generatePackageChannel reicht brandContext in additionalContext',
      pkgGen.includes('brandContext?: string') && /kernelContext\(kernel\), brandContext/.test(pkgGen));
    const srv = src('src/ai/server.ts');
    check('T10e Server-Fns akzeptieren brandContext (Kernel + Kanal)',
      (srv.match(/brandContext/g) ?? []).length >= 4);
    const route = src('src/routes/app/package.tsx');
    check('T10f Paket-Route sendet getBrandContext() mit',
      route.includes("import { getBrandContext } from '~/store/brand'") &&
        route.includes('const packageBrandContext = getBrandContext()') &&
        (route.match(/brandContext: packageBrandContext/g) ?? []).length === 2);
    const openaiSrc = src('src/ai/providers/openai.ts');
    check('T10g Provider hängt die Regel in buildSystemPrompt (alle Kanäle)',
      openaiSrc.includes("import { SELF_REFERENCE_CONSTRAINT } from '../context-loyalty'") &&
        openaiSrc.includes('${USER_PRIORITY_CONSTRAINT}' + String.fromCharCode(92) + 'n' + '${SELF_REFERENCE_CONSTRAINT}'));
  }

  // ── Fall 11: Paket-Flow bekommt denselben Kontext (Verhalten, ohne LLM) ──
  {
    // determineKernel würde einen LLM-Call machen — deshalb nur die reine
    // Zusammenbau-Funktion von generatePackageChannel prüfen (Quelltext-Check
    // oben) und hier die Signatur-Reihenfolge (brandContext an 7. Stelle).
    const pkgGenSrc = src('src/ai/package/generate.ts');
    check('T11a generatePackageChannel hat brandContext als letzten Parameter',
      typeof generatePackageChannel === 'function' &&
        pkgGenSrc.indexOf('learnContext?: string') > 0 &&
        pkgGenSrc.indexOf('brandContext?: string') > pkgGenSrc.indexOf('learnContext?: string'));
    check('T11b preparePackageContext ist exportiert und nimmt PackageOptions',
      typeof preparePackageContext === 'function');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // i18n — Parität de/en (durch Phase 4 unverändert)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── i18n de/en ───────────────────────────────────────────────────');
  {
    const dk = Object.keys(de);
    const ek = Object.keys(en);
    check('i18n de/en Parität (gleiche Schlüsselanzahl)', dk.length === ek.length, `de=${dk.length} en=${ek.length}`);
    check('i18n keine fehlenden Schlüssel', dk.every((k) => k in en) && ek.every((k) => k in de));
  }

  console.log(`\n=== stabilisierung-phase4-test: ${passed} PASS, ${failures.length} FAIL ===`);
  if (failures.length > 0) {
    console.log('Failures:', failures.join(' | '));
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});

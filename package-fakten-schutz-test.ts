// ─────────────────────────────────────────────────────────────────────────────
// Owner-Entscheid 2026-10-01 (Teil 2) — FAKTEN-SCHUTZ IM PACKAGE-FLOW
// Test-Suite (Teil 3 des Auftrags)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):
//   bun package-fakten-schutz-test.ts
//
// Deckt ab:
//   A. Die 4 Beleg-Muster aus dem Demo-Bericht (docs/auto-save-paket-evidence.md,
//      demo-decision-flow/BERICHT.md) werden als Verstöße erkannt (de+en):
//      (1) Ich-Anekdote „Letztes Jahr habe ich für den Geburtstag meines Sohnes…"
//      (2) „in 3–5 Werktagen" + „können wir leider keine Rückgabe akzeptieren"
//      (3) Pin-Titel „Diesen Geburtstagstrend lieben alle Eltern: …"
//      (4) Fremd-Beispiel-Slug „/trauerkarten-gestalten-persoenlich"
//   B. Grounding: Nutzerangaben (Lieferzeit/Preis/Rückgabe vom Nutzer) werden
//      NICHT geflaggt — falsch-positive Erkennung ist ausgeschlossen.
//   C. Retry-/Reject-Logik im Generierungspfad (injizierter Runner):
//      1 Korrektur mit benanntem Verstoß → sauber; danach Satz-Eliminierung;
//      wenn nichts Faktenfreies übrig bleibt, harter Fehler (FACT_GUARD_ERROR).
//   D. Kein Einfluss auf Nicht-Paket-Pfade (ohne enforceFacts unverändert).
//   E. Prompt-Regel in ALLEN 5 Kanal-Prompts + Erfindungs-Einladungen entfernt.
//   F. Paket-Flow aktiviert den Check (Quelltext-Beleg) + Hinweis-Pfad
//      (Score-Issues) läuft durch den Fakten-Check.
//
// Keine DB-, keine Netzwerk- und keine LLM-Aufrufe: reine Funktionen,
// injizierte Runner und Quelltext-Checks. Exit-Code 0 nur, wenn alles grün ist.
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
  FACT_GUARD_ERROR,
  FACT_PROTECTION_CONSTRAINT,
  FACT_VIOLATION_PREFIX,
  buildFactGrounding,
  factGuardCorrection,
  factViolationLabels,
  factViolations,
  resultFactViolations,
  sanitizeFactResult,
  sanitizeFactText,
} from './src/ai/fact-guard';
import { runWithContextLoyalty } from './src/ai/generate';
import { buildSystemPrompt } from './src/ai/providers/openai';
import { generatePackageChannel } from './src/ai/package/generate';
import { generatePackageChannelWithContext } from './src/ai/package/package';
import type { ContentRequest, ContentResult, ContentType } from './src/ai/types';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

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

// ── Nutzerangaben des Live-E2E-Demos (Owner-Vergleichslauf) ───────────────────
const IDEA_DE = 'Personalisierte Geburtstagskerzen aus Bienenwachs für Kinder';
const GROUNDING_DE = IDEA_DE;
const GROUNDING_EN = 'Personalized birthday candles made of beeswax for kids';

const CHANNELS: ContentType[] = [
  'pinterest_pin',
  'etsy_listing',
  'seo_blog',
  'social_post',
  'email_newsletter',
];

const FAKE_SCORE_FREE = { total: 82, subScores: [], issues: [], summary: '', ruleVersion: 1 };

function resultOf(title: string, body: string, contentType: ContentType = 'seo_blog'): ContentResult {
  return { contentType, title, body };
}

async function main(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // A. Die 4 Beleg-Muster werden erkannt (de+en)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── A. Beleg-Muster (Owner-Demo) ─────────────────────────────────');

  // (1) Erfundenes Nutzer-Erlebnis im SEO-Blogartikel (wörtlich aus dem Bericht)
  const beleg1 =
    'Ein Beispiel aus der Praxis: Letztes Jahr habe ich für den Geburtstag meines Sohnes eine Kerze mit seinem Lieblingstier gestaltet. Die Freude, als er die Kerze sah, war unbezahlbar.';
  const v1 = factViolations(beleg1, GROUNDING_DE);
  check(
    '(1) Ich-Anekdote „Letztes Jahr habe ich … meines Sohnes" erkannt',
    v1.length > 0 && v1.every((v) => v.startsWith(FACT_VIOLATION_PREFIX)),
    v1.join('|'),
  );
  check(
    '(1b) Erkennung basiert auf dem Anekdoten-Muster',
    v1.some((v) => v.includes('anekdote-letztes-jahr') || v.includes('geburtstag-meines-sohnes')),
    v1.join('|'),
  );
  check(
    '(1c) Anekdote im englischen Text erkannt',
    factViolations("Last year I made a candle for my son's birthday and his joy was priceless.", GROUNDING_EN)
      .length > 0,
  );

  // (2) Erfundene Lieferzeit + Rückgaberegel (wörtlich aus dem Bericht)
  const beleg2 =
    'Deine personalisierte Kerze kommt in 3–5 Werktagen bei dir an. Da jede Kerze individuell personalisiert wird, können wir leider keine Rückgabe akzeptieren.';
  const v2 = factViolations(beleg2, GROUNDING_DE);
  check('(2) Lieferzeit „in 3–5 Werktagen" erkannt', v2.some((v) => v.includes('in-x-tagen-wochen')), v2.join('|'));
  check('(2b) Rückgaberegel „keine Rückgabe akzeptieren" erkannt', v2.some((v) => v.includes('rueckgaberecht')), v2.join('|'));
  check(
    '(2c) Zweiter Beleg-Satz „in wenigen Tagen hältst du sie in den Händen" erkannt',
    factViolations('In wenigen Tagen hältst du sie in den Händen.', GROUNDING_DE).length > 0,
  );
  check(
    '(2d) Versandkosten-/Versandzusagen (de+en) erkannt',
    factViolations('Versandkostenfrei ab 30 € innerhalb Deutschlands.', GROUNDING_DE).length > 0 &&
      factViolations('Free shipping on all orders.', GROUNDING_EN).length > 0 &&
      factViolations('Ships in 2 business days.', GROUNDING_EN).length > 0,
  );
  check(
    '(2e) Erfundene Bearbeitungszeit (de+en) erkannt',
    factViolations('Die Bearbeitungszeit beträgt 7 Tage.', GROUNDING_DE).length > 0 &&
      factViolations('Processing time: 5 days.', GROUNDING_EN).length > 0,
  );

  // (3) Unbelegte Trend-/Alle-Aussage im Pin-Titel (wörtlich aus dem Bericht)
  const beleg3 = 'Diesen Geburtstagstrend lieben alle Eltern: personalisierte Kerzen aus Bienenwachs';
  const v3 = resultFactViolations({ title: beleg3, body: 'Schöne Idee.' }, GROUNDING_DE);
  check('(3) Pin-Titel „Diesen Geburtstagstrend lieben alle Eltern" erkannt', v3.length > 0, v3.join('|'));
  check('(3b) Trend-Behauptung als Kategorie benannt', v3.some((v) => v.includes('trend-behauptung')), v3.join('|'));
  check('(3c) „alle lieben …"-Muster erkannt', v3.some((v) => v.includes('alle-lieben')), v3.join('|'));
  check(
    '(3d) Weitere Trend-/Beliebtheits-Behauptungen (de+en) erkannt',
    factViolations('Der Bestseller unter den Geschenkideen.', GROUNDING_DE).length > 0 &&
      factViolations('The most popular gift of 2026.', GROUNDING_EN).length > 0,
  );

  // (4) Fremd-Beispiel-Slug im Verbesserungshinweis (wörtlich aus dem Bericht)
  const beleg4Orig =
    'Erstelle einen kurzen URL-Slug mit dem Fokus-Keyword, ohne Sonderzeichen (z. B. /trauerkarten-gestalten-persoenlich).';
  const v4 = factViolations(beleg4Orig, GROUNDING_DE);
  check('(4) Fremd-Slug „/trauerkarten-gestalten-persoenlich" erkannt', v4.some((v) => v.includes('fremd-slug')), v4.join('|'));
  check(
    '(4b) Fremd-URL/-Domain erkannt',
    factViolations('Mehr Ideen findest du unter https://www.trauerkarten-shop.de/ideen', GROUNDING_DE).length > 0,
  );
  const cleanedHint = sanitizeFactText(beleg4Orig, GROUNDING_DE);
  check('(4c) Hinweis wird nach Satz-Eliminierung slagfrei', !/trauerkarten/.test(cleanedHint), cleanedHint);
  check(
    '(4d) Slug aus dem Nutzerthema wird NICHT geflaggt',
    factViolations('Setze den Slug auf /geburtstagskerzen-bienenwachs.', 'geburtstagskerzen bienenwachs').length === 0,
  );
  check(
    '(4e) Echter Verbesserungshinweis aus der Scoring-Regel ist slagfrei',
    !/trauerkarten/.test(src('src/ai/scoring/rules.ts')),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // B. Grounding — belegte Nutzerfakten werden nie geflaggt
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── B. Grounding (falsch-positive ausgeschlossen) ────────────────');
  const userGrounding =
    'Handgegossene Bienenwachskerzen, Lieferzeit 3–5 Werktage, Rückgabe innerhalb 14 Tagen, Preis 29 EUR, Trend-Thema Bienenwachs, Website www.kerzenmanufaktur.de';
  check(
    'B1 Belegte Lieferzeit/Rückgabe/Preis aus Nutzerangaben NICHT geflaggt',
    factViolations('Wir versenden in 3–5 Werktagen. Rückgabe innerhalb 14 Tagen möglich. Preis: 29 EUR.', userGrounding)
      .length === 0,
    factViolations('Wir versenden in 3–5 Werktagen. Rückgabe innerhalb 14 Tagen möglich. Preis: 29 EUR.', userGrounding).join('|'),
  );
  check(
    'B2 Belegter Trend-Begriff des Nutzers NICHT geflaggt',
    factViolations('Der Bienenwachs-Trend hält an.', userGrounding).length === 0,
  );
  check(
    'B3 Belegte Nutzer-URL NICHT geflaggt',
    factViolations('Alle Infos auf https://www.kerzenmanufaktur.de/shop', userGrounding).length === 0,
  );
  check(
    'B4 Sauberes Paket-Asset ohne erfundene Fakten ist konform',
    resultFactViolations(
      {
        title: 'Personalisierte Geburtstagskerzen aus Bienenwachs für Kinder',
        body:
          'Diese Kerzen aus Bienenwachs lassen sich mit einem Namen personalisieren und passen zum Geburtstag. Sie eignen sich als Geschenk für Kinder und machen den Tag besonders.',
      },
      GROUNDING_DE,
    ).length === 0,
  );
  check(
    'B5 Leerer/fehlender Text wirft nie Verstöße',
    factViolations('', GROUNDING_DE).length === 0 && factViolations(undefined as unknown as string, GROUNDING_DE).length === 0,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // C. Retry-/Reject-Logik (injizierter Runner, ohne Netzwerk)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── C. Korrektur-Retry, Satz-Eliminierung, harter Fehler ─────────');

  const badFirst = resultOf('Geburtstagstrend', beleg1 + ' ' + beleg2 + ' ' + beleg3);
  const cleanSecond = resultOf(
    'Personalisierte Geburtstagskerzen aus Bienenwachs',
    'Diese Kerzen aus Bienenwachs lassen sich mit einem Namen personalisieren und passen zum Geburtstag für Kinder.',
  );

  // C1: erster Versuch mit Verstoß, Korrektur sauber
  {
    const seen: ContentRequest[] = [];
    let call = 0;
    const run = async (req: ContentRequest): Promise<ContentResult> => {
      seen.push(req);
      call++;
      return call === 1 ? badFirst : cleanSecond;
    };
    const out = await runWithContextLoyalty(
      { contentType: 'seo_blog', productIdea: IDEA_DE, enforceFacts: true },
      run,
    );
    check('C1 Verstoß im Erstversuch → genau 1 Korrekturversuch', out.attempts === 2 && seen.length === 2);
    check('C1b Korrektur-Hinweis nennt den konkreten Verstoß', /FAKTEN-KORREKTUR/.test(seen[1].correctionNote ?? ''), (seen[1].correctionNote ?? '').slice(0, 80));
    check('C1c Akzeptierte Ausgabe ist der korrigierte Versuch', out.result.title === cleanSecond.title && !out.corrected);
    check('C1d factCorrected markiert den Fakten-Retry', out.factCorrected === true && out.factSanitized !== true);
  }

  // C2: Korrektur bleibt fehlerhaft → Satz-Eliminierung (letzte Instanz)
  {
    let call = 0;
    const run = async (): Promise<ContentResult> => {
      call++;
      return call === 1 ? badFirst : resultOf('Personalisierte Geburtstagskerzen aus Bienenwachs', 'Diese Kerzen aus Bienenwachs sind ein schönes Geschenk. ' + beleg2);
    };
    const out = await runWithContextLoyalty(
      { contentType: 'seo_blog', productIdea: IDEA_DE, enforceFacts: true },
      run,
    );
    check('C2 Zweiter Verstoß → Satz-Eliminierung statt Fehler', out.factSanitized === true && out.attempts === 2);
    check(
      'C2b Ausgabe ist faktenfrei (kein „3–5 Werktagen", keine Rückgabe-Regel)',
      resultFactViolations(out.result, GROUNDING_DE).length === 0 && !/Werktagen|Rückgabe/.test(out.result.body),
      out.result.body.slice(0, 120),
    );
    check('C2c Faktenfreier Teil bleibt erhalten', /Bienenwachs/.test(out.result.body));
  }

  // C3: nichts Faktenfreies übrig → harter Fehler, nichts wird still geliefert
  {
    const run = async (): Promise<ContentResult> => resultOf(beleg3, beleg2);
    let threw = '';
    try {
      await runWithContextLoyalty({ contentType: 'seo_blog', productIdea: IDEA_DE, enforceFacts: true }, run);
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err);
    }
    check('C3 nur Verstöße (kein Restsatz) → ehrlicher Fehler (FACT_GUARD_ERROR)', threw === FACT_GUARD_ERROR, threw.slice(0, 80));
  }

  // C3b: nur der Titel fällt weg → Titel aus der Produktidee (belegt), kein Fehler
  {
    const run = async (): Promise<ContentResult> =>
      resultOf(beleg3, 'Diese Kerzen aus Bienenwachs lassen sich mit einem Namen personalisieren und passen zum Geburtstag.');
    const out = await runWithContextLoyalty(
      { contentType: 'pinterest_pin', productIdea: IDEA_DE, enforceFacts: true },
      run,
    );
    check('C3b Weggefallener Titel wird durch die belegte Produktidee ersetzt', out.factSanitized === true && out.result.title === IDEA_DE, out.result.title);
    check(
      'C3b2 Ausgabe bleibt faktenfrei und body bleibt erhalten',
      resultFactViolations(out.result, GROUNDING_DE).length === 0 && /Bienenwachs/.test(out.result.body),
    );
  }

  // C4: ohne enforceFacts bleibt alles wie bisher (kein Eingriff in andere Pfade)
  {
    let call = 0;
    const run = async (): Promise<ContentResult> => {
      call++;
      return badFirst;
    };
    const out = await runWithContextLoyalty({ contentType: 'seo_blog', productIdea: IDEA_DE }, run);
    check('C4 Ohne enforceFacts: 1 Versuch, Inhalt unverändert (kein Eingriff)', call === 1 && out.attempts === 1 && out.result.title === badFirst.title);
    check('C4b Ohne enforceFacts: kein Fakten-Retry markiert', out.factCorrected !== true && out.factSanitized !== true);
  }

  // C5: Kontexttreue bleibt hart (Stabilisierung 4.2 unangetastet)
  {
    const selfRef = resultOf('Growimo zeigt dir alles', 'Growimo hilft dir beim Marketing.');
    const run = async (): Promise<ContentResult> => selfRef;
    let threw = '';
    try {
      await runWithContextLoyalty({ contentType: 'seo_blog', productIdea: IDEA_DE, enforceFacts: true }, run);
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err);
    }
    check('C5 Kontexttreue bleibt hart (Selbstbezug → Fehler)', /Growimo selbst/.test(threw), threw.slice(0, 60));
  }

  // C6: Grounding im Paket-Request schützt Nutzerfakten auch im Retry-Pfad
  {
    const withUserFacts = resultOf(
      'Personalisierte Kerzen',
      'Lieferzeit 3–5 Werktage und Rückgabe innerhalb 14 Tagen — genau wie in deinem Shop angegeben.',
    );
    let call = 0;
    const run = async (): Promise<ContentResult> => {
      call++;
      return withUserFacts;
    };
    const out = await runWithContextLoyalty(
      {
        contentType: 'etsy_listing',
        productIdea: IDEA_DE,
        enforceFacts: true,
        factGrounding: 'Lieferzeit 3–5 Werktage, Rückgabe innerhalb 14 Tagen',
      },
      run,
    );
    check('C6 Nutzerbelegte Lieferzeit im Paket-Lauf: kein Retry, kein Eingriff', call === 1 && out.result.body === withUserFacts.body);
  }

  // C7: buildFactGrounding entfernt den LLM-Kernel, behält Nutzerangaben
  {
    const req: Pick<ContentRequest, 'productIdea' | 'additionalContext'> = {
      productIdea: IDEA_DE,
      additionalContext: [
        'Gemeinsamer Strategie-Kern (für dieses Paket verbindlich — verwende diese Keywords, diese Hauptbotschaft, diesen CTA und diese Stimme in deinem Output):',
        '- Keywords: Bestseller-Trend, alle lieben Kerzen',
        '- Hauptbotschaft/Hook: Der Trend 2026',
        '',
        'MARKENKONTEXT: Marke: Kerzenmanufaktur, Website: www.kerzenmanufaktur.de',
      ].join('\n'),
    };
    const grounding = buildFactGrounding(req);
    check('C7 Kernel-Block nicht im Grounding (kein Entwaffnen des Checks)', !/Strategie-Kern|alle lieben Kerzen/.test(grounding), grounding.slice(0, 80));
    check('C7b Markenangaben bleiben im Grounding', /kerzenmanufaktur/.test(grounding));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // D. Prompt-Regel + Entfernen der Erfindungs-Einladungen
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── D. Prompt-Regel in allen 5 Kanälen ───────────────────────────');
  check(
    'D1 FACT_PROTECTION_CONSTRAINT steht in ALLEN 5 Kanal-Prompts',
    CHANNELS.every((ct) => buildSystemPrompt(ct).includes(FACT_PROTECTION_CONSTRAINT)),
  );
  check(
    'D2 Regel nennt alle 5 Verbot-Kategorien (de)',
    /Ich-Form/.test(FACT_PROTECTION_CONSTRAINT) &&
      /Lieferzeiten/.test(FACT_PROTECTION_CONSTRAINT) &&
      /Rückgabe/.test(FACT_PROTECTION_CONSTRAINT) &&
      /Preise/.test(FACT_PROTECTION_CONSTRAINT) &&
      /Trend/.test(FACT_PROTECTION_CONSTRAINT) &&
      /Slug/.test(FACT_PROTECTION_CONSTRAINT),
  );
  check('D3 Zweisprachigkeit (de+en) in der Regel', /EN:/.test(FACT_PROTECTION_CONSTRAINT) && /never invent/i.test(FACT_PROTECTION_CONSTRAINT));

  const promptSrc = src('src/ai/providers/openai.ts');
  const inventionInvites: Array<[string, string]> = [
    ['Pin-Titel-Trigger „Diesen [Produkt]-Trend lieben gerade ALLE"', 'Diesen [Produkt]-Trend lieben gerade ALLE'],
    ['Etsy-CTA-Beispiel „in 3–5 Tagen hältst du es in den Händen"', 'in 3–5 Tagen hältst du es in den Händen'],
    ['SEO-Slug-Beispiel /trauerkarten-gestalten-persoenlich', '/trauerkarten-gestalten-persoenlich'],
    ['SEO-Vorgabe „Mindestens EIN persönliches Beispiel oder Erfahrungsbericht"', 'Mindestens EIN persönliches Beispiel oder Erfahrungsbericht'],
    ['Newsletter-Eröffnung „ein „Ich"-Moment"', 'ein „Ich"-Moment'],
    ['Newsletter-Versandbeispiel „Kostenloser Versand bis morgen"', 'Kostenloser Versand bis morgen'],
    ['SEO-Meta-Beispiel „Trauerkarten selbst gestalten"', 'Trauerkarten selbst gestalten'],
    ['Pinterest-Titelbeispiel „in 10 Minuten zum Profi-Ergebnis"', 'in 10 Minuten zum Profi-Ergebnis'],
  ];
  for (const [label, needle] of inventionInvites) {
    check(`D4 Erfindungs-Einladung entfernt: ${label}`, !promptSrc.includes(needle));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // E. Verdrahtung: Paket-Flow + Hinweis-Pfad
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── E. Verdrahtung (Paket-Flow + Hinweise) ───────────────────────');
  check('E1 Paket-Kanal (Batch) aktiviert den Fakten-Check', /enforceFacts: true/.test(src('src/ai/package/generate.ts')));
  check('E2 Paket-Kanal (progressiver UI-Pfad) aktiviert den Fakten-Check', /enforceFacts: true/.test(src('src/ai/package/package.ts')));
  check('E3 Paket-Batch übergibt Nutzer-Grounding (Idee+Brief+Marke)', /factGrounding: userGrounding/.test(src('src/ai/package/generate.ts')));
  check('E4 Hinweis-Pfad (Score-Issues) läuft durch den Fakten-Check', /factSafeIssues\(/.test(src('src/ai/scoring/index.ts')));
  check('E5 Verbesserungs-Prompt enthält die Fakten-Regel', /FAKTEN-SCHUTZ \(harte Regel\)/.test(src('src/ai/improve.ts')));
  check('E6 buildSystemPrompt hängt die Fakten-Regel an jeden Kanal', /FACT_PROTECTION_CONSTRAINT/.test(src('src/ai/providers/openai.ts')));
  check('E7 generate.ts nutzt den Fakten-Check nur mit enforceFacts', /enforceFacts === true/.test(src('src/ai/generate.ts')));
  check('E8 TikTok-Modul unangetastet (kein Fakten-Import, Story-Check bleibt eigen)', !/fact-guard/.test(src('src/ai/tiktok.ts')));
  check(
    'E9 generatePackageChannel/…WithContext sind exportiert und nutzbar',
    typeof generatePackageChannel === 'function' && typeof generatePackageChannelWithContext === 'function',
  );
  check('E10 FACT_VIOLATION_PREFIX stabil (FACT:)', FACT_VIOLATION_PREFIX === 'FACT:');
  check(
    'E11 Korrektur-Hinweis nennt Kategorien de+en',
    (() => {
      const hint = factGuardCorrection(['FACT:lieferzeit', 'FACT:fremd-slug']);
      return /Liefer/.test(hint) && /slug/i.test(hint) && /EN:/.test(hint);
    })(),
  );
  check(
    'E12 factViolationLabels mappt Kategorien lesbar',
    factViolationLabels(['FACT:trend-behauptung']).join('|').includes('Trend-Behauptung'),
    factViolationLabels(['FACT:trend-behauptung']).join('|'),
  );
  check('E13 FAKE_SCORE_FREE bleibt ohne Wirkung (Platzhalter für Re-Scoring)', FAKE_SCORE_FREE.total === 82);
  check(
    'E14 sanitizeFactResult lässt saubere Ergebnisse unverändert (identisches Objekt)',
    (() => {
      const clean = resultOf('Personalisierte Kerzen aus Bienenwachs', 'Diese Kerzen sind ein schönes Geschenk.');
      return sanitizeFactResult(clean, GROUNDING_DE) === clean;
    })(),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // F. Regression: bestehende Regeln bleiben grün
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── F. Regression (bestehende Gates) ─────────────────────────────');
  check('F1 i18n de/en Parität (gleiche Schlüsselanzahl)', Object.keys(de).length === Object.keys(en).length, `de=${Object.keys(de).length} en=${Object.keys(en).length}`);
  check('F2 i18n keine fehlenden Schlüssel', Object.keys(de).every((k) => k in en) && Object.keys(en).every((k) => k in de));
  check(
    'F3 Kontexttreue-Regel der Kanäle unverändert vorhanden',
    CHANNELS.every((ct) => buildSystemPrompt(ct).includes('VORRANG DER NUTZEREINGABE')),
  );

  console.log(`\n=== package-fakten-schutz-test: ${passed} PASS, ${failures.length} FAIL ===`);
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

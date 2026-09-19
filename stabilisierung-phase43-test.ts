// ─────────────────────────────────────────────────────────────────────────────
// Stabilisierung Phase 4.3 — Test-Suite: „Zuletzt erstellt" (Ergebnisse behalten,
// Wiederöffnen, „In Projekt speichern").
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):  bun stabilisierung-phase43-test.ts
//
// Deckt den Fix-Plan §4.3 ab:
//   * Liste max. 3, neues Ergebnis an Position 0, Deduplizierung, Kappung
//   * versioniertes Speicherformat: alte Einträge OHNE Version werden ignoriert,
//     das Phase-3-Einzelergebnis wird einmalig migriert
//   * Wiederöffnen liefert das IDENTISCHE Ergebnis (keine Neu-Generierung)
//   * „In Projekt speichern" nutzt den vorhandenen saveProject-Weg mit den
//     korrekten Argumenten (kein DB-Schema-/ContentType-Eingriff)
//   * Zähl-Semantik: Öffnen/Speichern verbrauchen KEINE Generierung
//   * i18n de/en Parität der neuen Strings
// Keine DB-, keine Netzwerkzugriffe: reine Funktionen + Quelltext-Checks.
// Exit-Code 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

// ── sessionStorage-Shim (die lib-Module lesen/schreiben sessionStorage) ───────
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

import type { TikTokDiagnoseResult, TikTokIdeaResult } from './src/ai/tiktok';
import type { Translations } from './src/i18n';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import {
  clearTikTokResult,
  parseTikTokResult,
  saveTikTokResult,
  TIKTOK_RESULT_KEY,
} from './src/lib/last-result';
import {
  addRecentEntry,
  buildTikTokSaveArgs,
  clearRecentList,
  createRecentEntry,
  formatTikTokResultText,
  parseRecentList,
  pushRecentResult,
  readRawRecentList,
  readRecentList,
  recentEntryId,
  recentEntryLabel,
  recentProjectTitle,
  serializeRecentList,
  TIKTOK_RECENT_CONTENT_TYPE,
  TIKTOK_RECENT_KEY,
  TIKTOK_RECENT_LABEL_MAX,
  TIKTOK_RECENT_MAX,
  TIKTOK_RECENT_TTL_MS,
  TIKTOK_RECENT_VERSION,
} from './src/lib/tiktok-recent';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log('PASS:', name);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
    console.log('FAIL:', name, detail ? `— ${detail}` : '');
  }
}

const storage = (): MemoryStorage =>
  (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage;

const ROUTE = 'src/routes/app/tiktok.tsx';
const MODULE = 'src/lib/tiktok-recent.ts';
const routeSrc = readFileSync(ROUTE, 'utf8');
const moduleSrc = readFileSync(MODULE, 'utf8');

const NOW = 1_800_000_000_000;

/** Entfernt Block- und Zeilenkommentare (die Doku nennt Begriffe wie
 *  "generateTikTokServer" bewusst — geprüft wird der ausführbare Code). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function idea(over: Partial<TikTokIdeaResult> = {}): TikTokIdeaResult {
  return {
    mode: 'concept',
    idea: 'Kerzen gießen im Zeitraffer',
    hook: 'Das kostet dich 2 Minuten',
    length: '25–30 Sekunden',
    scenes: ['Intro', 'Guss', 'Ergebnis'],
    overlays: ['2 Minuten', 'Selbst gemacht'],
    spokenText: 'So gießt du deine eigene Kerze.',
    caption: 'Kerzen selber machen',
    hashtags: ['#kerzen', '#diy'],
    cta: 'Speichere den Beitrag',
    why: 'Kurzer Nutzen, klarer Beweis.',
    ...over,
  };
}

function diagnose(over: Partial<TikTokDiagnoseResult> = {}): TikTokDiagnoseResult {
  return {
    mode: 'diagnose',
    biggestProblem: 'Hook verliert in Sekunde 2',
    whatWorks: ['Klares Thema'],
    whatToImprove: ['Hook kürzen', 'Szenen schneller'],
    newHook: 'Stop – so verlierst du Zuschauer',
    optimized: 'Optimierter Ablauf …',
    nextTest: 'Hook A gegen Hook B testen',
    lengthRecommendation: {
      seconds: 21,
      structure: 'Hook 0–2s, Inhalt 2–18s, CTA 18–21s',
      reason: 'Basierend auf deinen 2500 Views bei 38% Watch-Rate.',
    },
    ...over,
  };
}

async function main(): Promise<void> {
  console.log('\n── 4.3 Liste: Position 0, Kappung, Dedup ──────────────────────');
  {
    const a = createRecentEntry('concept', idea({ idea: 'Alpha' }), 'Produkt A', NOW);
    const b = createRecentEntry('concept', idea({ idea: 'Beta' }), 'Produkt B', NOW + 1);
    const c = createRecentEntry('concept', idea({ idea: 'Gamma' }), 'Produkt C', NOW + 2);
    const d = createRecentEntry('concept', idea({ idea: 'Delta' }), 'Produkt D', NOW + 3);

    check('Eintrag trägt Versionsfeld', a.version === TIKTOK_RECENT_VERSION);
    check('Konstante max = 3', TIKTOK_RECENT_MAX === 3);
    check('Beschriftung kommt aus dem Ergebnis (keine Erfindung)', a.label === 'Alpha', a.label);

    const one = addRecentEntry([], a);
    check('erster Eintrag landet an Position 0', one.length === 1 && one[0].id === a.id);

    const two = addRecentEntry(one, b);
    check('neuer Eintrag steht an Position 0 (neueste zuerst)', two[0].id === b.id && two[1].id === a.id);

    const three = addRecentEntry(two, c);
    const four = addRecentEntry(three, d);
    check('Liste auf max. 3 gekappt', four.length === 3, `len=${four.length}`);
    check(
      'Kappung entfernt den ÄLTESTEN Eintrag',
      four[0].id === d.id && four[2].id === b.id && !four.some((e) => e.id === a.id),
    );

    const again = addRecentEntry(four, createRecentEntry('concept', idea({ idea: 'Beta' }), 'B2', NOW + 9));
    check('Duplikat wird entfernt statt doppelt geführt', again.length === 3, `len=${again.length}`);
    check('Deduplizierter Eintrag steht vorn und ist aktualisiert', again[0].id === b.id && again[0].savedAt === NOW + 9);
    check(
      'Eintrags-ID ist deterministisch (Modus + Beschriftung)',
      recentEntryId('concept', idea({ idea: 'Beta' })) === b.id,
    );
    check(
      'unterschiedliche Modi kollidieren nicht',
      recentEntryId('diagnose', diagnose()) !== recentEntryId('concept', idea()),
    );
  }

  console.log('\n── 4.3 Format: Version, TTL, defekte Daten ────────────────────');
  {
    const a = createRecentEntry('concept', idea({ idea: 'Alpha' }), 'Produkt A', NOW);
    const raw = serializeRecentList([a]);
    check('serialisierte Liste enthält das Versionsfeld', JSON.parse(raw)[0].version === TIKTOK_RECENT_VERSION);
    check('parse liefert den Eintrag zurück', parseRecentList(raw, NOW).length === 1);

    // Eintrag OHNE Versionsfeld (Format von vor Phase 4.3) → ignorieren.
    const legacy = JSON.stringify([
      { mode: 'concept', result: idea({ idea: 'Alt' }), savedAt: NOW, label: 'Alt', productIdea: '', id: 'x' },
    ]);
    check('Eintrag OHNE Version wird ignoriert', parseRecentList(legacy, NOW).length === 0);
    const wrongVersion = JSON.stringify([{ ...a, version: TIKTOK_RECENT_VERSION + 1 }]);
    check('Eintrag mit fremder Version wird ignoriert', parseRecentList(wrongVersion, NOW).length === 0);
    const mixed = JSON.stringify([
      { mode: 'concept', result: idea(), savedAt: NOW },
      JSON.parse(raw)[0],
    ]);
    check('gemischte Liste: nur der gültige Eintrag überlebt', parseRecentList(mixed, NOW).length === 1);
    check('unbekannter Modus wird ignoriert', parseRecentList(JSON.stringify([{ ...a, mode: 'foo' }]), NOW).length === 0);
    check('defektes JSON → leere Liste (kein Crash)', parseRecentList('{nope', NOW).length === 0);
    check('null → leere Liste', parseRecentList(null, NOW).length === 0);
    check('Ergebnis ohne mode-Feld wird verworfen', parseRecentList(JSON.stringify([{ ...a, result: {} }]), NOW).length === 0);
    check(
      'abgelaufener Eintrag (TTL 12 h überschritten) wird verworfen',
      parseRecentList(raw, NOW + TIKTOK_RECENT_TTL_MS + 1).length === 0,
    );
    check('frischer Eintrag überlebt die TTL-Prüfung', parseRecentList(raw, NOW + 60_000).length === 1);
    check(
      'Liste im Speicher wird auf max. 3 gekappt',
      parseRecentList(serializeRecentList([a, { ...a, id: 'i2' }, { ...a, id: 'i3' }, { ...a, id: 'i4' }]), NOW).length === 3,
    );
  }

  console.log('\n── 4.3 sessionStorage: Push, Wiederöffnen, Migration ──────────');
  {
    storage().clear();
    const r1 = idea({ idea: 'Erster Lauf' });
    const list1 = pushRecentResult('concept', r1, 'Kerzen', NOW);
    check('Push schreibt die Liste in den sessionStorage', storage().getItem(TIKTOK_RECENT_KEY) !== null);
    check('Push gibt die neue Liste zurück', list1.length === 1 && list1[0].mode === 'concept');
    check('Produktbezug wird mitgespeichert', list1[0].productIdea === 'Kerzen');

    const r2 = idea({ idea: 'Zweiter Lauf' });
    pushRecentResult('concept', r2, 'Kerzen', NOW + 10);
    const read = readRawRecentList(NOW + 20);
    check('neuester Eintrag steht vorn', read[0].label === 'Zweiter Lauf');
    check('älterer Eintrag bleibt erhalten', read[1].label === 'Erster Lauf');

    const r3 = diagnose();
    const list3 = pushRecentResult('diagnose', r3, '', NOW + 30);
    check('Diagnose-Ergebnis wird ebenfalls aufgenommen', list3.length === 3 && list3[0].mode === 'diagnose');
    check(
      'Diagnose-Beschriftung = größtes Problem (Text aus dem Ergebnis)',
      list3[0].label === r3.biggestProblem,
      list3[0].label,
    );
    check(
      'Wiederöffnen liefert das IDENTISCHE Ergebnis (Diagnose)',
      JSON.stringify(readRawRecentList(NOW + 40)[0].result) === JSON.stringify(r3),
    );
    check(
      'Wiederöffnen liefert das IDENTISCHE Ergebnis (Idee, inkl. Listen-Felder)',
      JSON.stringify(readRawRecentList(NOW + 40)[1].result) === JSON.stringify(r2),
    );
    check(
      'Wiederöffnen erzeugt KEINEN neuen Listeneintrag',
      readRawRecentList(NOW + 50).length === 3,
    );

    // Migration des Phase-3-Einzelergebnisses
    storage().clear();
    const legacyResult = idea({ idea: 'Aus Phase 3' });
    saveTikTokResult(legacyResult.mode, legacyResult, NOW);
    check('Phase-3-Schlüssel liegt vor der Migration', storage().getItem(TIKTOK_RESULT_KEY) !== null);
    const migrated = readRecentList(NOW + 5);
    check('Phase-3-Einzelergebnis wird einmalig in die Liste migriert', migrated.length === 1);
    check('migrierter Eintrag trägt die aktuelle Version', migrated[0].version === TIKTOK_RECENT_VERSION);
    check('migrierter Eintrag behält das Ergebnis byte-identisch', JSON.stringify(migrated[0].result) === JSON.stringify(legacyResult));
    check('Migration schreibt die Liste (nicht nur in den Speicher-State)', storage().getItem(TIKTOK_RECENT_KEY) !== null);
    check('Phase-3-Schlüssel bleibt unangetastet (Studio-Prefill)', parseTikTokResult(storage().getItem(TIKTOK_RESULT_KEY), NOW + 5) !== null);
    check('zweiter Aufruf dupliziert nicht (idempotent)', readRecentList(NOW + 6).length === 1);

    storage().clear();
    check('leerer Speicher → leere Liste (kein Crash)', readRecentList(NOW).length === 0);

    const r4 = idea({ idea: 'Aufräumen' });
    pushRecentResult('concept', r4, '', NOW);
    clearRecentList();
    check('clearRecentList leert nur die Liste', storage().getItem(TIKTOK_RECENT_KEY) === null);
    clearTikTokResult();
  }

  console.log('\n── 4.3 Beschriftung + Text-Serialisierung ────────────────────');
  {
    check(
      'Beschriftung wird auf die Maximallänge gekürzt',
      recentEntryLabel('concept', idea({ idea: 'x'.repeat(200) })).length <= TIKTOK_RECENT_LABEL_MAX,
      String(recentEntryLabel('concept', idea({ idea: 'x'.repeat(200) })).length),
    );
    check(
      'Beschriftung nutzt die erste Zeile',
      recentEntryLabel('concept', idea({ idea: 'Erste Zeile\nZweite Zeile' })) === 'Erste Zeile',
    );
    check(
      'Beschriftung fällt auf den Hook zurück, wenn die Idee leer ist',
      recentEntryLabel('concept', idea({ idea: '' })) === idea().hook,
    );
    check('Beschriftung crasht bei leerem Ergebnis nicht', recentEntryLabel('concept', idea({ idea: '', hook: '' })) === 'TikTok');

    const body = formatTikTokResultText(diagnose(), de);
    check('Asset-Body enthält das größte Problem', body.includes('Hook verliert in Sekunde 2'));
    check('Asset-Body enthält den neuen Hook', body.includes('Stop – so verlierst du Zuschauer'));
    check('Asset-Body enthält die Längen-Empfehlung mit Zahl', body.includes('21'));
    const bodyEn = formatTikTokResultText(idea(), en as unknown as Translations);
    check(
      'Asset-Body nutzt die Überschriften der Sprache',
      bodyEn.includes(`## ${(en as unknown as Translations).tiktok_result_idea}`),
      bodyEn.slice(0, 40),
    );
    const bodyDe = formatTikTokResultText(idea(), de);
    check('deutscher Asset-Body nutzt deutsche Überschriften', bodyDe.includes(`## ${de.tiktok_result_idea}`));
    check('Asset-Body enthält die Hashtags', bodyDe.includes('#kerzen'));
    check('Asset-Body ist nicht leer', bodyDe.trim().length > 100);
  }

  console.log('\n── 4.3 „In Projekt speichern" (vorhandener saveProject-Weg) ───');
  {
    const entry = createRecentEntry('concept', idea({ idea: 'Kerzen gießen' }), 'handgemachte Kerzen aus Hamburg', NOW);
    const args = buildTikTokSaveArgs(entry, 'user_123', de);
    check('Projekt-Argumente enthalten die Nutzer-ID', args.project.userId === 'user_123');
    check('Projekt-Status ist completed (wie im Muster)', args.project.status === 'completed');
    check('ContentType ist social_post (KEIN ContentType-Eingriff)', args.project.contentTypes[0] === 'social_post');
    check(
      'genau EIN Asset wird gespeichert',
      args.contents.length === 1 && args.contents[0].contentType === TIKTOK_RECENT_CONTENT_TYPE,
    );
    check('Produktidee des Projekts = echter Produktbezug', args.project.productIdea === 'handgemachte Kerzen aus Hamburg');
    check('Asset-Titel = Listen-Beschriftung', args.contents[0].title === entry.label);
    check('Asset-Metadata nennt die Herkunft tiktok', args.contents[0].metadata.source === 'tiktok');
    check('Asset-Metadata trägt Modus + Eintrags-ID', args.contents[0].metadata.tiktokMode === 'concept' && args.contents[0].metadata.tiktokEntryId === entry.id);
    check('Asset-Metadata trägt den Erstellungszeitpunkt', args.contents[0].metadata.tiktokCreatedAt === NOW);
    check('Asset-Body enthält den Inhalt des Ergebnisses', args.contents[0].body.includes('Kerzen gießen'));

    const noIdea = buildTikTokSaveArgs(createRecentEntry('concept', idea({ idea: 'Ohne Produktangabe' }), '  ', NOW), 'u2', de);
    check('ohne Produktbezug fällt das Projekt auf die Beschriftung zurück', noIdea.project.productIdea === 'Ohne Produktangabe');
    check('Projekttitel wird auf 50 Zeichen gekürzt', recentProjectTitle('y'.repeat(80)).length === 53);
    check('kurzer Projekttitel bleibt unverändert', recentProjectTitle('Kurz') === 'Kurz');

    // Aufruf der Kette wie im Component-Code (Spy statt DB): saveProject(uid, project, contents)
    const calls: Array<{ uid: string; project: unknown; contents: unknown[] }> = [];
    const fakeSaveProject = async (uid: string, project: unknown, contents: unknown[]) => {
      calls.push({ uid, project, contents });
      return { id: 'proj_1' };
    };
    const uid = 'user_123';
    const built = buildTikTokSaveArgs(entry, uid, de);
    await fakeSaveProject(uid, built.project, built.contents);
    check('saveProject-Weg wird mit (uid, project, contents) aufgerufen', calls.length === 1 && calls[0].uid === uid);
    check('übergebenes Projekt enthält die Nutzer-ID', (calls[0].project as { userId?: string }).userId === uid);
    check('übergebene Inhalte enthalten genau 1 Asset', Array.isArray(calls[0].contents) && calls[0].contents.length === 1);
    check(
      'übergebenes Asset hat contentType/title/body/metadata',
      typeof (calls[0].contents[0] as { body?: string }).body === 'string' &&
        (calls[0].contents[0] as { contentType?: string }).contentType === 'social_post',
    );
  }

  console.log('\n── 4.3 Zähl-Semantik (0 Verbrauch beim Öffnen/Speichern) ──────');
  {
    // Die Persistenz-Schicht darf keinen KI-/Usage-Pfad kennen — geprüft wird
    // der CODE (Kommentare entfernt; die Doku nennt die Begriffe bewusst).
    const stripped = stripComments(moduleSrc);
    for (const forbidden of ['generateTikTokServer', 'usage', 'withGenerationGuard', 'openai', 'fetch(']) {
      check(
        `Modul kennt keinen KI-/Usage-Pfad (${forbidden})`,
        !stripped.toLowerCase().includes(forbidden.toLowerCase()),
      );
    }
    const openStart = routeSrc.indexOf('ein früheres Ergebnis wieder ÖFFNEN');
    const saveStart = routeSrc.indexOf('„In Projekt speichern" über den VORHANDENEN');
    const saveEnd = routeSrc.indexOf('/** Phase 3 UX-Fix — Diagnose-Karte wählt nur den Modus an', saveStart);
    check('openRecent-Block gefunden (inkl. Doku)', openStart > 0);
    check('saveRecentToProject-Block gefunden (inkl. Doku)', saveStart > openStart);
    check('Ende des Speicher-Blocks gefunden', saveEnd > saveStart);
    const openSrc = routeSrc.slice(openStart, saveStart);
    const saveSrc = routeSrc.slice(saveStart, saveEnd);
    // Code-Check auf den Handler-RÜMPFEN (Doku nennt den Generierungs-Aufruf
    // bewusst, um zu erklären, dass er hier NICHT stattfindet).
    const openCode = stripComments(routeSrc.slice(routeSrc.indexOf('const openRecent = ('), saveStart));
    const saveCode = stripComments(routeSrc.slice(routeSrc.indexOf('const saveRecentToProject = '), saveEnd));
    check(
      'Handler-Rümpfe der beiden Aktionen gefunden',
      openCode.includes('setResult(entry.result)') && saveCode.includes('saveProject(uid, args.project, args.contents)'),
    );
    check(
      'Wiederöffnen ruft KEINE Generierung',
      !openCode.includes('generateTikTokServer') && !openCode.includes('guardTikTokRun'),
    );
    check(
      'Speichern ruft KEINE Generierung',
      !saveCode.includes('generateTikTokServer') && !saveCode.includes('guardTikTokRun'),
    );
    check('Speichern nutzt den vorhandenen saveProject-Weg', saveSrc.includes('saveProject(uid, args.project, args.contents)'));
    check(
      'saveProject wird aus ~/store/projects importiert (kein neuer DB-Pfad)',
      /import \{[^}]*saveProject[^}]*\} from '~\/store\/projects';/.test(routeSrc),
    );
    check(
      'genau EINE Generierungs-Aufrufstelle in der Route (unverändert)',
      (routeSrc.match(/generateTikTokServer\(/g) ?? []).length === 1,
      String((routeSrc.match(/generateTikTokServer\(/g) ?? []).length),
    );
    check(
      'Zähl-Semantik ist im Speicher-Handler dokumentiert',
      /0 Generierungen verbraucht/.test(saveSrc),
    );
    check(
      'Zähl-Semantik ist im Öffnen-Handler dokumentiert',
      /keine Generierung wird verbraucht/.test(openSrc),
    );
    check(
      'Zähl-Semantik ist im Modulkopf dokumentiert',
      /Zahl-SEMANTIK|ZAHL-SEMANTIK/.test(moduleSrc),
    );
  }

  console.log('\n── 4.3 Verdrahtung in der Route (Quelltext) ──────────────────');
  {
    check('Route importiert die Listen-APIs', /from '~\/lib\/tiktok-recent'/.test(routeSrc));
    check('Route liest die Liste beim Mount', routeSrc.includes('setRecent(readRecentList());'));
    check(
      'Route nimmt neue Ergebnisse in die Liste auf (Position 0 via pushRecentResult)',
      /setRecent\(\s*pushRecentResult\(/.test(routeSrc),
    );
    check('Route zeigt die Sektion „Zuletzt erstellt"', routeSrc.includes('data-testid="tiktok-recent"'));
    check('jeder Eintrag hat einen Öffnen-Button', routeSrc.includes('data-testid="tiktok-recent-open"'));
    check('jeder Eintrag hat einen Speichern-Button', routeSrc.includes('data-testid="tiktok-recent-save"'));
    check('neue i18n-Keys werden in der UI verwendet', routeSrc.includes('t.tiktok_recent_title') && routeSrc.includes('t.tiktok_recent_save'));
    check('„Neue Idee" leert die Liste NICHT (Ergebnisse bleiben)', !/const reset = \(\) => \{[\s\S]*?clearRecentList\(\)[\s\S]*?\};/.test(routeSrc));
    check(
      'kein DB-Schema-Eingriff (kein tiktok in schema.ts)',
      !readFileSync('src/db/schema.ts', 'utf8').toLowerCase().includes('tiktok'),
    );
    const typesSrc = readFileSync('src/ai/types.ts', 'utf8');
    const union = typesSrc.slice(typesSrc.indexOf('export type ContentType'), typesSrc.indexOf('export interface ContentRequest'));
    check('kein ContentType-Eingriff (tiktok nicht im Union)', !union.toLowerCase().includes('tiktok'));
    check('gespeicherter ContentType ist social_post', TIKTOK_RECENT_CONTENT_TYPE === 'social_post');
  }

  console.log('\n── 4.3 i18n de/en ────────────────────────────────────────────');
  {
    const keys = [
      'tiktok_recent_title',
      'tiktok_recent_hint',
      'tiktok_recent_open',
      'tiktok_recent_open_active',
      'tiktok_recent_save',
      'tiktok_recent_saving',
      'tiktok_recent_saved',
      'tiktok_recent_save_error',
      'tiktok_recent_mode_today',
      'tiktok_recent_mode_concept',
      'tiktok_recent_mode_diagnose',
    ];
    for (const key of keys) {
      check(
        `i18n de+en: ${key}`,
        typeof (de as unknown as Record<string, unknown>)[key] === 'string' &&
          typeof (en as unknown as Record<string, unknown>)[key] === 'string',
      );
    }
    const dk = Object.keys(de);
    const ek = Object.keys(en);
    check('i18n de/en Parität (gleiche Schlüsselanzahl)', dk.length === ek.length, `de=${dk.length} en=${ek.length}`);
    check('i18n keine fehlenden Schlüssel', dk.every((k) => k in en) && ek.every((k) => k in de));
  }

  console.log(`\n=== stabilisierung-phase43-test: ${passed} PASS, ${failures.length} FAIL ===`);
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

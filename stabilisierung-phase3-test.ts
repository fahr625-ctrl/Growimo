// ─────────────────────────────────────────────────────────────────────────────
// Stabilisierung Phase 3 — Test-Suite: Bild-Studio & Workflow
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):  bun stabilisierung-phase3-test.ts
//
// Deckt den Fix-Plan Phase 3 ab:
//   3.1 Timeout/Retry/Fehlerbanner — client-seitige Guard (120 s) + Abbruch:
//       die Promise settelt IMMER, `imageErrorTextKey` liefert die ehrliche
//       Meldung; Code-Checks belegen Guard-Nutzung + Fehlerbanner + Abbrechen.
//   3.2 Gates ohne Deadlock — Beta-Gate (Timeout/Schonfrist/kein checkedEmailRef)
//       und ProtectedRoute (Timeout + „Seite neu laden“).
//   3.3 TikTok↔Studio ohne Datenverlust — Router-Link statt Anchor,
//       sessionStorage-Persistenz des Ergebnisses (Version + TTL),
//       nicht-zerstörender Strategie-Prefill + Prefill-Fallback.
//   3.4 Speicherlast — Galerie-Begrenzung (capGallery, max 8).
//
// Keine DB-, keine Netzwerkzugriffe: reine Funktionen + Quelltext-Checks.
// Exit-Code 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { join } from 'path';

// ── sessionStorage-Shim (die lib-Module lesen/schreiben sessionStorage) ──────
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
  capGallery,
  guardImageRun,
  imageErrorTextKey,
  ImageClientAbortError,
  IMAGE_CLIENT_TIMEOUT_MS,
  IMAGE_GALLERY_MAX,
} from './src/lib/image-safeguards';
import { resolveStudioPrefill, studioSearch, studioSearchPrefill, studioDeepLink } from './src/lib/studio-deeplink';
import {
  clearStrategyPrefill,
  consumeStrategyPrefill,
  readStrategyPrefill,
  saveStrategyPrefill,
  STRATEGY_PREFILL_KEY,
  STRATEGY_PREFILL_TTL_MS,
} from './src/lib/strategy-image';
import {
  clearTikTokResult,
  parseTikTokResult,
  readTikTokResult,
  saveTikTokResult,
  serializeTikTokResult,
  TIKTOK_RESULT_KEY,
  TIKTOK_RESULT_VERSION,
} from './src/lib/last-result';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log('PASS:', name);
  } else {
    failures.push(name);
    console.log('FAIL:', name, '—', detail);
  }
}

const root = __dirname;
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Wartet auf die Guard-Promise und liefert Fehler-Name/-Grund. */
async function settleOutcome<T>(p: Promise<T>): Promise<{ ok: boolean; value?: T; err?: unknown; ms: number }> {
  const start = Date.now();
  try {
    const value = await p;
    return { ok: true, value, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, err, ms: Date.now() - start };
  }
}

const strategyPayload = {
  prompt: 'sunlit ceramics studio, warm beige, vertical',
  concept: 'Bildkonzept',
  overlay: 'Mehr Ruhe im Raum',
  ratio: '2:3' as const,
  contentType: 'pinterest_pin',
  platform: 'Pinterest',
};

const ideaResult = {
  mode: 'todayIdea' as const,
  hook: 'Hook',
  caption: 'Caption',
  hashtags: ['#a'],
  imageIdeas: [{ description: 'd', studioPrompt: 'p' }],
} as unknown as Parameters<typeof saveTikTokResult>[1];

async function main(): Promise<void> {
  const storage = (globalThis as { sessionStorage: MemoryStorage }).sessionStorage;

  // ── 3.1 Guard: Timeout ────────────────────────────────────────────────────
  {
    const guard = guardImageRun(() => new Promise<never>(() => {}), 40);
    const out = await settleOutcome(guard.promise);
    check('3.1 Timeout bricht ab (kein Hänger)', !out.ok && out.ms < 2_000, `ms=${out.ms}`);
    check('3.1 Timeout-Grund ist "timeout"', guard.reason() === 'timeout', String(guard.reason()));
    check(
      '3.1 Timeout wirft ImageClientAbortError',
      out.err instanceof ImageClientAbortError && (out.err as ImageClientAbortError).reason === 'timeout',
      String((out.err as Error)?.name),
    );
    check('3.1 Fehlertext-Schlüssel = image_studio_error_timeout', imageErrorTextKey(guard.reason()) === 'image_studio_error_timeout');
  }
  // ── 3.1 Guard: Nutzer-Abbruch ─────────────────────────────────────────────
  {
    let seenSignal: AbortSignal | null = null;
    const guard = guardImageRun((signal) => {
      seenSignal = signal;
      return new Promise<never>(() => {});
    }, 5_000);
    setTimeout(() => guard.abort('user'), 20);
    const out = await settleOutcome(guard.promise);
    check('3.1 „Abbrechen“ settelt die Promise', !out.ok && out.ms < 2_000, `ms=${out.ms}`);
    check('3.1 Abbruch-Grund ist "user"', guard.reason() === 'user');
    check('3.1 Signal wird an den Aufrufer durchgereicht und abgebrochen', !!seenSignal && (seenSignal as AbortSignal).aborted === true);
    check('3.1 Fehlertext-Schlüssel = image_studio_error_aborted', imageErrorTextKey('user') === 'image_studio_error_aborted');
    check('3.1 zweiter abort() ist No-op (Grund bleibt "user")', (guard.abort('timeout'), guard.reason() === 'user'));
  }
  // ── 3.1 Guard: Erfolg + Serverfehler bleiben unverändert ──────────────────
  {
    let signal: AbortSignal | null = null;
    const guard = guardImageRun((s) => {
      signal = s;
      return Promise.resolve({ url: 'data:image/png;base64,AAAA' });
    }, 5_000);
    const out = await settleOutcome(guard.promise);
    check('3.1 erfolgreicher Lauf liefert das Ergebnis durch', out.ok && out.value?.url.startsWith('data:image/png'), JSON.stringify(out.value));
    check('3.1 erfolgreicher Lauf setzt keinen Abbruchgrund (Timer wird geräumt)', guard.reason() === null);
    check('3.1 erfolgreicher Lauf bricht das Signal nicht ab', !!signal && (signal as AbortSignal).aborted === false);
    check('3.1 Timeout-Konstante = 120 s (Messbasis 16–23 s + Reserve)', IMAGE_CLIENT_TIMEOUT_MS === 120_000);

    const serverErr = new Error('Monatliches Limit erreicht');
    const guard2 = guardImageRun(() => Promise.reject(serverErr), 5_000);
    const out2 = await settleOutcome(guard2.promise);
    check(
      '3.1 Serverfehler kommt unverfälscht an (Limit-Meldung bleibt sichtbar)',
      !out2.ok && out2.err === serverErr && guard2.reason() === null,
    );
    check('3.1 Fehlertext-Schlüssel ohne Abbruch = generisch', imageErrorTextKey(null) === 'image_studio_error');
  }

  // ── 3.4 Galerie-Begrenzung ────────────────────────────────────────────────
  {
    check('3.4 Galerie-Limit ist 8', IMAGE_GALLERY_MAX === 8);
    const items = Array.from({ length: 5 }, (_, i) => `img${i}`);
    const five = capGallery(items);
    check('3.4 unter dem Limit bleibt alles erhalten', five.items.length === 5 && five.dropped === 0);
    const twelve = capGallery(Array.from({ length: 12 }, (_, i) => `img${i}`));
    check('3.4 über dem Limit bleiben die NEUESTEN 8 (Reihenfolge neu→alt)', twelve.items.length === 8 && twelve.items[0] === 'img0' && twelve.items[7] === 'img7');
    check('3.4 dropped meldet die herausgefallenen Bilder', twelve.dropped === 4, String(twelve.dropped));
    const source = ['a', 'b'];
    const capped = capGallery(source, 1);
    check('3.4 Original wird nicht mutiert', source.length === 2 && capped.items.length === 1 && capped.items[0] === 'a');
    check('3.4 max=0 liefert leere Galerie ohne Crash', capGallery(['a'], 0).items.length === 0);
  }

  // ── 3.3c Prefill-Auflösung (kein Einmal-Prefill ohne Fallback) ─────────────
  {
    const strat = resolveStudioPrefill('?fromStrategy=1', strategyPayload);
    check('3.3c fromStrategy + Payload → Strategie-Prompt + Stamp', strat.prompt === strategyPayload.prompt && strat.strategy !== null && strat.fromTikTok === false);
    const fallback = resolveStudioPrefill('?fromStrategy=1&prompt=TikTok%20Bildidee', null);
    check(
      '3.3c fromStrategy OHNE Payload fällt auf ?prompt= zurück (kein Early-Return mehr)',
      fallback.prompt === 'TikTok Bildidee' && fallback.strategy === null,
      JSON.stringify(fallback),
    );
    const fallbackIdea = resolveStudioPrefill('?fromStrategy=1&idea=Kerzen', null);
    check('3.3c fromStrategy ohne Payload nutzt auch ?idea= als Fallback', fallbackIdea.prompt === 'Kerzen');
    check('3.3c fromStrategy ohne alles → leerer Prompt statt Absturz', resolveStudioPrefill('?fromStrategy=1', null).prompt === '');
    const tik = resolveStudioPrefill('?prompt=Keramikvase%20in%20Beige', null);
    check('3.3c TikTok-Deep-Link befüllt den Prompt und meldet den Rückweg', tik.prompt === 'Keramikvase in Beige' && tik.fromTikTok === true);
    const both = resolveStudioPrefill('?prompt=P&idea=I', null);
    check('3.3c ?prompt= hat Vorrang vor ?idea=', both.prompt === 'P');
    const ideaOnly = resolveStudioPrefill('?idea=Kerzen', null);
    check('3.3c ?idea= bleibt unverändert nutzbar (kein TikTok-Rückweg)', ideaOnly.prompt === 'Kerzen' && ideaOnly.fromTikTok === false);
    check('3.3c ?prompt= + fromStrategy MIT Payload → Strategie behält Vorrang', resolveStudioPrefill('?fromStrategy=1&prompt=P', strategyPayload).prompt === strategyPayload.prompt);
    check('3.3a SPA-Search-Objekt entspricht der Deep-Link-URL', studioSearch('abc def').prompt === 'abc def' && studioDeepLink('abc').startsWith('/app/image-studio?prompt='));
    check('3.3a studioSearchPrefill liest fromStrategy korrekt', studioSearchPrefill('?fromStrategy=1').fromStrategy === true && studioSearchPrefill('?x=1').fromStrategy === false);
  }

  // ── 3.3c Strategie-Prefill: nicht mehr zerstörend + TTL ───────────────────
  {
    storage.clear();
    saveStrategyPrefill(strategyPayload, 1_000_000);
    const first = readStrategyPrefill(1_000_100);
    const second = readStrategyPrefill(1_000_200);
    check('3.3c zweites Lesen liefert den Prefill erneut (nicht konsumiert)', first?.prompt === strategyPayload.prompt && second?.prompt === strategyPayload.prompt);
    check('3.3c Payload enthält savedAt (TTL-Basis)', JSON.parse(storage.getItem(STRATEGY_PREFILL_KEY)!).savedAt === 1_000_000);
    check('3.3c abgelaufener Prefill (TTL 24 h) wird ignoriert', readStrategyPrefill(1_000_000 + STRATEGY_PREFILL_TTL_MS + 1) === null);
    check('3.3c Alt-Eintrag ohne savedAt bleibt gültig (Abwärtskompatibilität)', (storage.setItem(STRATEGY_PREFILL_KEY, JSON.stringify(strategyPayload)), consumeStrategyPrefill(9_999_999_999)?.prompt === strategyPayload.prompt));
    clearStrategyPrefill();
    check('3.3c clearStrategyPrefill entfernt den Eintrag', storage.getItem(STRATEGY_PREFILL_KEY) === null);
    storage.setItem(STRATEGY_PREFILL_KEY, '{kaputt');
    check('3.3c defekter Eintrag → null statt Crash', readStrategyPrefill() === null);
  }

  // ── 3.3b TikTok-Ergebnis-Persistenz (C5) ──────────────────────────────────
  {
    storage.clear();
    check('3.3b ohne gespeichertes Ergebnis → null', readTikTokResult() === null);
    saveTikTokResult('todayIdea', ideaResult, 5_000);
    const restored = readTikTokResult(5_100);
    check('3.3b Ergebnis überlebt Bereichswechsel/Zurück/Reload', restored?.result.mode === 'todayIdea' && restored?.mode === 'todayIdea');
    check('3.3b gespeicherter Eintrag ist versioniert', JSON.parse(storage.getItem(TIKTOK_RESULT_KEY)!).version === TIKTOK_RESULT_VERSION);

    const stale = serializeTikTokResult('concept', ideaResult, 1_000);
    check('3.3b abgelaufener Eintrag (TTL 12 h) wird ignoriert', parseTikTokResult(stale, 1_000 + 12 * 60 * 60 * 1000 + 1) === null);
    check('3.3b frischer Eintrag innerhalb der TTL gilt', parseTikTokResult(stale, 1_000 + 60_000)?.mode === 'concept');
    check('3.3b falsche/ältere Version wird ignoriert', parseTikTokResult(JSON.stringify({ version: 0, mode: 'todayIdea', result: ideaResult, savedAt: 1_000 }), 1_000) === null);
    check('3.3b defektes JSON → null statt Crash', parseTikTokResult('{nope', 1_000) === null);
    check('3.3b unbekannter Modus → null', parseTikTokResult(JSON.stringify({ version: 1, mode: 'x', result: ideaResult, savedAt: 1_000 }), 1_000) === null);
    check('3.3b leerer/null-Eintrag → null', parseTikTokResult(null, 1_000) === null && parseTikTokResult('null', 1_000) === null);
    check('3.3b Ergebnis ohne mode → null (kein Fremd-Objekt im State)', parseTikTokResult(JSON.stringify({ version: 1, mode: 'todayIdea', result: { hook: 'x' }, savedAt: 1_000 }), 1_000) === null);

    const diag = { mode: 'diagnose', newHook: 'x' } as unknown as Parameters<typeof saveTikTokResult>[1];
    saveTikTokResult('diagnose', diag, 7_000);
    check('3.3b Diagnose-Ergebnis wird pro Modus wiederhergestellt', readTikTokResult(7_000)?.mode === 'diagnose');
    clearTikTokResult();
    check('3.3b „Neue Session“ räumt die Persistenz', storage.getItem(TIKTOK_RESULT_KEY) === null && readTikTokResult() === null);
  }

  // ── 3.1/3.2/3.3 Code-Struktur (Quelltext-Checks) ──────────────────────────
  {
    const studio = read('src/routes/app/image-studio.tsx');
    check('3.1 Studio nutzt die Guard (guardImageRun)', studio.includes('guardImageRun(') && studio.includes("} from '~/lib/image-safeguards'"));
    check('3.1 Guard wird für Hauptkarte UND Karten-Aktionen genutzt', (studio.match(/guardImageRun\(/g) || []).length >= 2);
    check('3.1 ServerFn erhält das AbortSignal', studio.includes('aspectRatio: selectedRatio }, signal }') && studio.includes('aspectRatio: image.aspectRatio }, signal }'));
    check('3.1 loading endet garantiert im finally', studio.includes('finally { runGuardRef.current = null; setLoading(false); }'));
    check('3.1 „Abbrechen“-Button ruft abort("user")', studio.includes("runGuardRef.current?.abort('user')") && studio.includes('{t.image_studio_abort}'));
    check('3.1 Banner zeigt Timeout-/Abbruch-Text mit Retry', studio.includes('{usageError ?? errorText}') && studio.includes('{t.analysis_retry}'));
    check('3.1 kein direkter ServerFn-Aufruf mehr außerhalb der Guard', !/await generateImageServer\(/.test(studio));
    check('3.1 unhandled rejection der Projektliste abgefangen', studio.includes('getProjectsByUser(user.id).then(setProjects).catch('));
    check('3.3c Studio nutzt die getestete Prefill-Auflösung (kein Early-return)', studio.includes('resolveStudioPrefill(window.location.search, readStrategyPrefill())') && !studio.includes('consumeStrategyPrefill('));
    check('3.3d Rückweg „Zurück zur TikTok-Idee“ im Studio', studio.includes('{t.image_studio_back_to_tiktok}') && studio.includes('to="/app/tiktok"'));
    check('3.4 Studio begrenzt die Galerie über capGallery', studio.includes('capGallery([image, ...prev], IMAGE_GALLERY_MAX)') && studio.includes('t.image_studio_gallery_cap_hint'));
    check('3.4 Galerie-Hinweis ist nur ab dem Limit sichtbar', studio.includes('generatedCount > IMAGE_GALLERY_MAX &&'));

    const tik = read('src/routes/app/tiktok.tsx');
    check('3.3a Studio-Sprung ist ein Router-Link (SPA), kein Vollseiten-Anchor', !tik.includes('studioDeepLink') && tik.includes('search={studioSearch(img.studioPrompt)}'));
    check('3.3b Ergebnis wird gespeichert', tik.includes('saveTikTokResult(res.mode, res)'));
    check('3.3b Ergebnis wird beim Mount wiederhergestellt', tik.includes('readTikTokResult()') && tik.includes('setResult(restored.result)'));
    check('3.3b „Neue Session“ räumt die Persistenz', tik.includes('clearTikTokResult()'));

    const app = read('src/routes/app.tsx');
    check('3.2 Beta-Gate hat ein Fetch-Timeout (10 s)', app.includes('BETA_ACCESS_TIMEOUT_MS = 10_000') && app.includes('setTimeout(() => { if (!cancelled) settle(\'error\'); }, BETA_ACCESS_TIMEOUT_MS)'));
    check('3.2 leere E-Mail → Schonfrist statt Dauer-„checking“', app.includes('BETA_EMAIL_GRACE_MS = 5_000') && app.includes("if (!email) {"));
    check('3.2 Deadlock-Ref checkedEmailRef ist entfernt', !app.includes('checkedEmailRef'));
    check('3.2 verspätete Antworten überschreiben keinen Endzustand', app.includes("setBeta((prev) => (prev === 'checking' ? v : prev))"));
    check('3.2 Retry-Button öffnet den Check erneut', app.includes('const retryAccessCheck = () =>') && app.includes('setBeta("checking")'));

    const pr = read('src/components/ProtectedRoute.tsx');
    check('3.2 ProtectedRoute hat ein Lade-Timeout (12 s)', pr.includes('AUTH_LOAD_TIMEOUT_MS = 12_000'));
    check('3.2 ProtectedRoute bietet nach Timeout „Seite neu laden“', pr.includes('data-testid="auth-load-timeout"') && pr.includes('window.location.reload()') && pr.includes('{t.common_reload}'));
    check('3.2 kein Dauer-„Lädt...“ ohne Ausweg', pr.includes("slowLoad && ("));
  }

  // ── i18n: neue Strings in beiden Sprachen + Parität ───────────────────────
  {
    const required = [
      'common_reload',
      'gate_slow_title',
      'gate_slow_text',
      'image_studio_error_timeout',
      'image_studio_error_aborted',
      'image_studio_abort',
      'image_studio_back_to_tiktok',
      'image_studio_gallery_cap_hint',
    ];
    for (const key of required) {
      check(
        `i18n de+en: ${key}`,
        typeof (de as Record<string, unknown>)[key] === 'string' && typeof (en as Record<string, unknown>)[key] === 'string',
      );
    }
    check('i18n Timeout-Text enthält den Platzhalter %s', (de as Record<string, string>).image_studio_error_timeout.includes('%s') && (en as Record<string, string>).image_studio_error_timeout.includes('%s'));
    check('i18n Galerie-Hinweis enthält den Platzhalter %s', (de as Record<string, string>).image_studio_gallery_cap_hint.includes('%s'));
    const dk = Object.keys(de);
    const ek = Object.keys(en);
    check('i18n de/en Parität (gleiche Schlüsselanzahl)', dk.length === ek.length, `de=${dk.length} en=${ek.length}`);
    check('i18n keine fehlenden Schlüssel', dk.every((k) => k in en) && ek.every((k) => k in de));
  }

  console.log(`\n=== stabilisierung-phase3-test: ${passed} PASS, ${failures.length} FAIL ===`);
  if (failures.length > 0) {
    console.log('Failures:', failures.join(' | '));
    // Kein process.exit(): Bun schreibt stdout asynchron (Datei-Redirect) und
    // würde die Ausgabe beim sofortigen Exit abschneiden.
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});

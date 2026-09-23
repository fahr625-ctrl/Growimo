// ─────────────────────────────────────────────────────────────────────────────
// Stabilisierung Phase 5d (Fund 3) — Test-Suite: persistente Studio-Galerie.
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):  bun stabilisierung-phase43b-test.ts
//
// Deckt den Fix „Galerie nicht navigationsfest" ab (5c-Befund: nach Zurück/
// Vorwärts war die Galerie leer, obwohl die Generierungen verbraucht waren):
//   * Speichern nach der Generierung (sessionStorage, versioniert)
//   * Wiederherstellen nach simuliertem Reload (identische Inhalte, Reihenfolge)
//   * Kappung (Anzahl) + Zeichen-Budget + Quota-Fallback
//   * Versions- und TTL-Verhalten (fail-closed bei fremder/fehlender Version)
//   * keine doppelten Bilder
//   * 0 verbrauchte Generierungen beim Wiederherstellen
//   * Verdrahtung der Route (Effekt beim Mount, Persistenz in addImage)
//   * i18n de/en Parität der neuen Strings
// Keine DB-, keine Netzwerkzugriffe: reine Funktionen + Quelltext-Checks.
// Exit-Code 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

// ── sessionStorage-Shim (das lib-Modul liest/schreibt sessionStorage) ─────────
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
/** Wirft ab `limit` Zeichen wie ein voller sessionStorage (QuotaExceededError). */
class QuotaStorage extends MemoryStorage {
  constructor(private limit: number) {
    super();
  }
  override setItem(key: string, value: string): void {
    if (String(value).length > this.limit) {
      const err = new Error('QuotaExceededError: sessionStorage full');
      err.name = 'QuotaExceededError';
      throw err;
    }
    super.setItem(key, value);
  }
}
const initialStorage = new MemoryStorage();
(globalThis as { sessionStorage?: unknown }).sessionStorage = initialStorage;
const storage = (): MemoryStorage => (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage;

import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import { IMAGE_GALLERY_MAX, capGallery } from './src/lib/image-safeguards';
import {
  addEntry,
  buildEntry,
  buildPersistEntries,
  clearGallery,
  entryChars,
  IMAGE_GALLERY_ENTRY_MAX_CHARS,
  IMAGE_GALLERY_PERSIST_BUDGET_CHARS,
  IMAGE_GALLERY_PERSIST_MAX,
  IMAGE_GALLERY_STORAGE_KEY,
  IMAGE_GALLERY_STORAGE_VERSION,
  IMAGE_GALLERY_TTL_MS,
  IMAGE_PREVIEW_MAX_EDGE,
  makePreviewUrl,
  needsPreview,
  parseGallery,
  planPersist,
  readGallery,
  serializeGallery,
  writeGallery,
} from './src/lib/image-gallery';

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

const MODULE = 'src/lib/image-gallery.ts';
const ROUTE = 'src/routes/app/image-studio.tsx';
const moduleSrc = readFileSync(MODULE, 'utf8');
const routeSrc = readFileSync(ROUTE, 'utf8');
/** Entfernt Block- und Zeilenkommentare (der Modulkopf NENNT bewusst Begriffe
 *  wie `generateImageServer`/`usage_monthly` — geprüft wird der ausführbare Code). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const moduleCode = stripComments(moduleSrc);
const routeCode = stripComments(routeSrc);

const NOW = 1_800_000_000_000;

/** Kurzes Fake-Bild (klein ⇒ kein Vorschau-Zwang). */
function img(id: string, over: Partial<{ url: string; prompt: string; aspectRatio: string; createdAt: number }> = {}) {
  return {
    id,
    url: over.url ?? `data:image/png;base64,AAA${id}`,
    prompt: over.prompt ?? `Prompt ${id}`,
    aspectRatio: over.aspectRatio ?? '2:3',
    createdAt: over.createdAt ?? NOW - 1000,
  };
}
/** Aufnahme, die die Zeichen-Obergrenze einer einzelnen Aufnahme überschreitet. */
function bigUrl(chars: number): string {
  return 'data:image/png;base64,' + 'A'.repeat(chars);
}

async function main(): Promise<void> {
  console.log('── 5d.1 Konstanten und Speicherformat ───────────────────────');
  {
    check('Storage-Key ist der dokumentierte Marker', IMAGE_GALLERY_STORAGE_KEY === 'growimo_image_studio_gallery');
    check('Format-Version ist 1', IMAGE_GALLERY_STORAGE_VERSION === 1);
    check('Persistenz-Kappung ist 3', IMAGE_GALLERY_PERSIST_MAX === 3);
    check('Galerie-Kappung im State bleibt 8 (unverändert)', IMAGE_GALLERY_MAX === 8);
    check('Budget liegt unter dem sessionStorage-Limit', IMAGE_GALLERY_PERSIST_BUDGET_CHARS <= 4_000_000);
    check('TTL ist 12 h', IMAGE_GALLERY_TTL_MS === 12 * 60 * 60 * 1000);
    check('Vorschau-Kante ist 720 px', IMAGE_PREVIEW_MAX_EDGE === 720);
    check('Einzel-Aufnahme-Grenze liegt unter dem Gesamt-Budget', IMAGE_GALLERY_ENTRY_MAX_CHARS < IMAGE_GALLERY_PERSIST_BUDGET_CHARS);
  }

  console.log('\n── 5d.2 Speichern nach der Generierung ─────────────────────');
  {
    storage().clear();
    const images = [img('a'), img('b'), img('c')];
    const entries = await buildPersistEntries(images, NOW);
    check('buildPersistEntries liefert je Bild eine Aufnahme', entries.length === 3);
    check('jede Aufnahme trägt die Version', entries.every((e) => e.version === IMAGE_GALLERY_STORAGE_VERSION));
    check('jede Aufnahme hat savedAt = now', entries.every((e) => e.savedAt === NOW));
    check('jede Aufnahme hat createdAt des Bildes', entries.every((e) => e.createdAt === NOW - 1000));
    const result = writeGallery(entries, IMAGE_GALLERY_PERSIST_MAX, IMAGE_GALLERY_PERSIST_BUDGET_CHARS);
    check('3 Aufnahmen werden gespeichert', result.stored === 3, JSON.stringify(result));
    check('nichts verworfen', result.dropped === 0);
    check('Schlüssel liegt im sessionStorage', storage().getItem(IMAGE_GALLERY_STORAGE_KEY) !== null);
    check('gespeicherte Nutzlast ist gültiges JSON-Array', Array.isArray(JSON.parse(storage().getItem(IMAGE_GALLERY_STORAGE_KEY)!)));
    const raw = storage().getItem(IMAGE_GALLERY_STORAGE_KEY)!;
    check('gespeicherte Nutzlast enthält alle 3 IDs', ['a', 'b', 'c'].every((id) => raw.includes(`"id":"${id}"`)));
    check('serializeGallery ist deterministisch', serializeGallery(entries) === serializeGallery(entries));
  }

  console.log('\n── 5d.3 Wiederherstellen nach simuliertem Reload ───────────');
  {
    // Reload = neues Modul-Laden auf DEMSELBEN sessionStorage (Session bleibt).
    const restored = readGallery(NOW + 1000);
    check('readGallery liefert 3 Aufnahmen (Reload)', restored.length === 3, `len=${restored.length}`);
    check('Reihenfolge bleibt neueste-zuerst', restored.map((r) => r.id).join(',') === 'a,b,c', restored.map((r) => r.id).join(','));
    check('URLs bleiben identisch', restored[0].url === 'data:image/png;base64,AAAa');
    check('Prompts bleiben identisch', restored[1].prompt === 'Prompt b');
    check('aspectRatio bleibt identisch', restored.every((r) => r.aspectRatio === '2:3'));
    check('createdAt bleibt erhalten (Date rekonstruierbar)', new Date(restored[0].createdAt).getTime() === NOW - 1000);
    check('preview-Flag ist false bei kleinen Bildern', restored.every((r) => r.preview === false));
    check('erneutes Lesen ist idempotent', JSON.stringify(readGallery(NOW + 2000)) === JSON.stringify(restored));
  }

  console.log('\n── 5d.4 Version + TTL (fail-closed) ────────────────────────');
  {
    const entry = buildEntry(img('v'), 'data:image/png;base64,AAA', false, NOW);
    check('Aufnahme ohne Versionsfeld wird ignoriert', parseGallery(JSON.stringify([{ ...entry, version: undefined }]), NOW).length === 0);
    check('Aufnahme mit fremder Version wird ignoriert', parseGallery(JSON.stringify([{ ...entry, version: 2 }]), NOW).length === 0);
    check('Aufnahme mit Version 1 wird übernommen', parseGallery(JSON.stringify([entry]), NOW).length === 1);
    check('Aufnahme mit fremder Version fällt nicht auf gültige zurück', parseGallery(JSON.stringify([{ ...entry, version: 99 }, entry]), NOW).length === 1);
    check('defektes JSON ⇒ leere Liste (kein Crash)', parseGallery('{nicht json', NOW).length === 0);
    check('kein Array ⇒ leere Liste', parseGallery('{"a":1}', NOW).length === 0);
    check('null ⇒ leere Liste', parseGallery(null, NOW).length === 0);
    check('fehlende URL wird ignoriert', parseGallery(JSON.stringify([{ ...entry, url: '' }]), NOW).length === 0);
    check('fehlende id wird ignoriert', parseGallery(JSON.stringify([{ ...entry, id: '' }]), NOW).length === 0);
    check('abgelaufene Aufnahme (TTL) wird ignoriert', parseGallery(JSON.stringify([entry]), NOW + IMAGE_GALLERY_TTL_MS + 1).length === 0);
    check('Aufnahme innerhalb der TTL bleibt', parseGallery(JSON.stringify([entry]), NOW + IMAGE_GALLERY_TTL_MS - 1).length === 1);
    check('savedAt beschreibt die TTL, nicht createdAt', parseGallery(JSON.stringify([{ ...entry, createdAt: NOW - IMAGE_GALLERY_TTL_MS * 3 }]), NOW).length === 1);
    check('preview-Flag wird übernommen', parseGallery(JSON.stringify([{ ...entry, preview: true }]), NOW)[0].preview === true);
  }

  console.log('\n── 5d.5 Kappung, Budget, Duplikate ─────────────────────────');
  {
    const list = [1, 2, 3, 4, 5].map((n) => buildEntry(img(`i${n}`), `data:image/png;base64,${n}`, false, NOW));
    const plan = planPersist(list);
    check('Kappung: nur die 3 neuesten Aufnahmen bleiben', plan.keep.length === IMAGE_GALLERY_PERSIST_MAX);
    check('Kappung: die neuesten sind i1,i2,i3', plan.keep.map((e) => e.id).join(',') === 'i1,i2,i3');
    check('Kappung: die Verwurfzahl wird gemeldet', plan.dropped === 2);
    const dup = addEntry([buildEntry(img('x'), 'data:image/png;base64,X', false, NOW)], buildEntry(img('x'), 'data:image/png;base64,X2', false, NOW + 1));
    check('Duplikat wird ersetzt statt doppelt', dup.length === 1 && dup[0].url.endsWith('X2'));
    const dupParsed = parseGallery(JSON.stringify([buildEntry(img('y'), 'data:image/png;base64,1', false, NOW + 5), buildEntry(img('y'), 'data:image/png;base64,2', false, NOW)]), NOW + 10);
    check('Duplikate beim Lesen entfernt (Neuestes gewinnt)', dupParsed.length === 1 && dupParsed[0].url.endsWith('1'));
    // Budget: erster Eintrag groß, zweiter sprengt das Budget ⇒ nur der erste bleibt.
    const big = buildEntry(img('big'), bigUrl(900), false, NOW);
    const small = buildEntry(img('small'), bigUrl(400), false, NOW);
    const budget = entryChars(big) + 10;
    const p2 = planPersist([big, small], 3, budget);
    check('Budget: zu große Folgeeinträge werden verworfen', p2.keep.length === 1 && p2.keep[0].id === 'big', JSON.stringify(p2.keep.map((e) => e.id)));
    check('Budget: ein einzelner zu großer Eintrag wird nicht verworfen', planPersist([big], 3, 5).keep.length === 1);
    check('Budget=0/unendlich ist unkritisch', planPersist([small, small], 3, Number.NaN).keep.length === 2);
    // Galerie-Kappung im State bleibt der bestehende Pfad.
    const state = capGallery([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], IMAGE_GALLERY_MAX);
    check('State-Galerie kappt weiter auf 8', state.items.length === 8 && state.dropped === 2);
  }

  console.log('\n── 5d.6 Quota-Fallback (voller sessionStorage) ─────────────');
  {
    const prev = storage();
    const failing = new QuotaStorage(2_000);
    (globalThis as { sessionStorage?: unknown }).sessionStorage = failing;
    const list = [1, 2, 3].map((n) => buildEntry(img(`q${n}`), 'data:image/png;base64,' + 'A'.repeat(900), false, NOW));
    const res = writeGallery(list);
    check('Quota-Fallback: kein Crash, weniger gespeichert', res.stored > 0 && res.stored < 3, JSON.stringify(res));
    check('Quota-Fallback: gespeicherter Stand ist lesbar', readGallery(NOW).length === res.stored);
    check('Quota-Fallback: Teilstände werden verworfen (Neueste bleiben)', (failing.getItem(IMAGE_GALLERY_STORAGE_KEY) ?? '').includes('q1'));
    const tiny = new QuotaStorage(10);
    (globalThis as { sessionStorage?: unknown }).sessionStorage = tiny;
    const res2 = writeGallery(list);
    check('Passt nicht einmal ein Eintrag ⇒ nichts Halbes gespeichert', res2.stored === 0 && tiny.getItem(IMAGE_GALLERY_STORAGE_KEY) === null);
    (globalThis as { sessionStorage?: unknown }).sessionStorage = prev;
  }

  console.log('\n── 5d.7 Vorschau-Entscheidung (Größe) ──────────────────────');
  {
    check('große Daten-URL braucht eine Vorschau', needsPreview(bigUrl(IMAGE_GALLERY_ENTRY_MAX_CHARS + 1)));
    check('kleine Daten-URL braucht keine Vorschau', !needsPreview('data:image/png;base64,AAA'));
    const carried = await buildPersistEntries([img('p')], NOW);
    check('übernommene Aufnahme trägt kein Vorschau-Flag', carried.length === 1 && carried[0].preview === false);
    const roundTrip = parseGallery(serializeGallery([buildEntry(img('pv'), 'data:image/jpeg;base64,PREVIEW', true, NOW)]), NOW);
    check('Vorschau-Flag überlebt die Speicher-Runde', roundTrip.length === 1 && roundTrip[0].preview === true && roundTrip[0].url.endsWith('PREVIEW'));
    // Node/Testharness hat kein canvas ⇒ makePreviewUrl ist ehrlich null.
    check('makePreviewUrl ist ohne Browser null (kein Crash)', (await makePreviewUrl(bigUrl(2000))) === null);
    const bigEntries = await buildPersistEntries([{ ...img('huge'), url: bigUrl(IMAGE_GALLERY_ENTRY_MAX_CHARS + 100) }], NOW);
    check('ohne Browser bleibt das Original (kein Datenverlust)', bigEntries[0].url.length > IMAGE_GALLERY_ENTRY_MAX_CHARS && bigEntries[0].preview === false);
    check('preview=false bei kleinen Bildern in der Route-Notation', (await buildPersistEntries([img('s')], NOW))[0].preview === false);
  }

  console.log('\n── 5d.8 Keine Generierung durch Speichern/Wiederherstellen ─');
  {
    check('Modul importiert keinen Usage-Guard', !moduleCode.includes('usage-guard'));
    check('Modul ruft keinen ServerFn auf', !moduleCode.includes('generateImageServer'));
    check('Modul umgeht withGenerationGuard nicht selbst', !moduleCode.includes('withGenerationGuard'));
    check('Modul kennt kein usage_monthly', !moduleCode.includes('usage_monthly'));
    check('Modul greift nicht auf die DB zu', !moduleCode.includes('getDb') && !moduleCode.includes('queries'));
    check('Modul benutzt ausschließlich sessionStorage', !/localStorage/.test(moduleCode));
    check('Modul schreibt keine Dateien', !moduleCode.includes('writeFile'));
    // Zahlen: gespeicherte Aufnahmen sind kein Generierungsverbrauch.
    storage().clear();
    const before = readGallery(NOW).length;
    await buildPersistEntries([img('z1'), img('z2')], NOW);
    const after = readGallery(NOW).length;
    check('Persistenz erzeugt keine neuen Galerie-Einträge aus dem Nichts', before === 0 && after === 0);
    writeGallery([buildEntry(img('c1'), 'data:image/png;base64,AAA', false, NOW)]);
    check('clearGallery entfernt die Galerie restlos', (clearGallery(), readGallery(NOW).length === 0 && storage().getItem(IMAGE_GALLERY_STORAGE_KEY) === null));
  }

  console.log('\n── 5d.9 Verdrahtung der Route (image-studio.tsx) ───────────');
  {
    check('Route importiert die Persistenz', routeSrc.includes("from '~/lib/image-gallery'"));
    check('Route liest die Galerie beim Mount (readGallery)', /readGallery\(\)/.test(routeCode));
    check('Route schreibt die Galerie nach jeder Generierung', /persistGallery\(next\)/.test(routeCode));
    check('Persistenz wird im addImage-Pfad ausgelöst (nicht erst onUnload)', /const addImage = \(image: GeneratedImage\) => \{[\s\S]*?persistGallery\(next\)/.test(routeCode));
    check('Wiederherstellung setzt den Galerie-State', /const entries = readGallery\(\);[\s\S]*?setImages\(restored\)/.test(routeCode));
    check('Wiederherstellung kostet keine Generierung (kein Server-Aufruf im Effekt)', !/const entries = readGallery\(\);[\s\S]{0,600}generateImageServer/.test(routeCode));
    check('galerieRef spiegelt den State für die Persistenz', routeCode.includes('imagesRef.current = next'));
    check('Galerie-Kappung nutzt weiter capGallery + IMAGE_GALLERY_MAX', /capGallery<StudioImage>\(\[image, \.\.\.imagesRef\.current\], IMAGE_GALLERY_MAX\)/.test(routeCode));
    check('Reload-Hinweis hat einen Test-Anker', routeSrc.includes('data-testid="image-gallery-restored-hint"'));
    check('Vorschau-Badge hat einen Test-Anker', routeSrc.includes('data-testid="image-preview-badge"'));
    check('Hinweis wird nur bei wiederhergestellten Bildern gezeigt', /restoredCount > 0 &&/.test(routeCode));
    check('neue i18n-Keys werden in der UI verwendet', routeCode.includes('t.image_studio_gallery_restored_hint') && routeCode.includes('t.image_studio_gallery_preview_badge'));
    check('Fehler der Persistenz können die Generierung nicht brechen', /persistGallery\(next\)\.catch\(/.test(routeCode));
    check('kein DB-Schema-Eingriff (keine Galerie-Tabelle)', !readFileSync('src/db/schema.ts', 'utf8').toLowerCase().includes('gallery'));
    const typesSrc = readFileSync('src/ai/types.ts', 'utf8');
    check('kein ContentType-Eingriff', !/image_gallery/.test(typesSrc));
  }

  console.log('\n── 5d.10 i18n de/en ────────────────────────────────────────');
  {
    const keys = [
      'image_studio_gallery_restored_hint',
      'image_studio_gallery_preview_badge',
      'image_studio_gallery_preview_hint',
    ];
    for (const key of keys) {
      check(
        `i18n de+en: ${key}`,
        typeof (de as unknown as Record<string, unknown>)[key] === 'string' &&
          typeof (en as unknown as Record<string, unknown>)[key] === 'string',
      );
    }
    check('Hinweis nutzt den %s-Platzhalter', ((de as unknown as Record<string, string>).image_studio_gallery_restored_hint ?? '').includes('%s'));
    const dk = Object.keys(de);
    const ek = Object.keys(en);
    check('i18n de/en Parität (gleiche Schlüsselanzahl)', dk.length === ek.length, `de=${dk.length} en=${ek.length}`);
    check('i18n keine fehlenden Schlüssel', dk.every((k) => k in en) && ek.every((k) => k in de));
  }

  console.log(`\n=== stabilisierung-phase43b-test: ${passed} PASS, ${failures.length} FAIL ===`);
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

/**
 * K4-B — Unit-Suite (pure Logik, netzfrei, DB-frei, 0 KI-Kosten)
 * Aufruf: `bun generated-images-logic-test.ts` · Exit 0 = grün.
 *
 * Deckt die Blöcke aus DESIGN-FREEZE §6a ab: Sliding Window, TTL, Guard,
 * Zugriffskontrolle, Cron-Auth, Zähl-Semantik (statisch), Invarianten-Pfade.
 */
import {
  IMAGE_GLOBAL_BYTES_CAP_DEFAULT,
  IMAGE_GLOBAL_WARN_BYTES_DEFAULT,
  IMAGE_MAX_PER_USER_DEFAULT,
  IMAGE_TTL_DAYS_DEFAULT,
  blobPrefixForUser,
  buildBlobPath,
  capPrompt,
  computeExpiresAt,
  cronAuthOk,
  decodeImageDataUrl,
  formatBytes,
  guardDecision,
  imageAccessStatus,
  isExpired,
  isGuardWarning,
  isValidDeleteReason,
  normalizeProjectId,
  parsePositiveInt,
  remainingBytes,
  resolveGlobalBytesCap,
  resolveGlobalWarnBytes,
  resolveImageLimits,
  selectOverflow,
  sortWindowAsc,
  toEpochMs,
} from './src/lib/generated-images-logic';

let checks = 0;
let failed = 0;
const failures: string[] = [];

function ok(cond: boolean, label: string) {
  checks += 1;
  if (!cond) {
    failed += 1;
    failures.push(label);
    console.error(`FAIL  ${label}`);
  }
}
function eq<T>(actual: T, expected: T, label: string) {
  ok(Object.is(actual, expected), `${label} (erwartet ${String(expected)}, war ${String(actual)})`);
}

// ── Block 1: Sliding Window (199/200/201, ältestes zuerst, Gleichstand, idempotent)

const row = (id: string, t: number) => ({ id, createdAt: new Date(t) });

// 199 Bilder: kein Überhang
eq(selectOverflow(Array.from({ length: 199 }, (_, i) => row(`r${i}`, i)), 200).length, 0, '199 Bilder → kein Überhang');
// genau 200: kein Überhang (der Cap ist erlaubt)
eq(selectOverflow(Array.from({ length: 200 }, (_, i) => row(`r${i}`, i)), 200).length, 0, '200 Bilder → kein Überhang');
// 201: genau das ÄLTESTE fällt raus
const overflow201 = selectOverflow(Array.from({ length: 201 }, (_, i) => row(`r${i}`, i)), 200);
eq(overflow201.length, 1, '201 Bilder → genau 1 Überhang');
eq(overflow201[0].id, 'r0', 'Überhang ist das älteste Bild');
// 205: die 5 ältesten
const overflow205 = selectOverflow(Array.from({ length: 205 }, (_, i) => row(`r${i}`, i)), 200).map((r) => r.id);
eq(overflow205.join(','), 'r0,r1,r2,r3,r4', '205 Bilder → die 5 ältesten');
// Gleichstand: deterministisch über id
const tie = sortWindowAsc([row('b', 100), row('a', 100), row('c', 99)]).map((r) => r.id);
eq(tie.join(','), 'c,a,b', 'Gleichstand deterministisch (created_at, dann id)');
// 2. Lauf ändert nichts (Funktion ist rein)
const twice = selectOverflow(Array.from({ length: 204 }, (_, i) => row(`r${i}`, i)), 200);
const twiceB = selectOverflow(Array.from({ length: 204 }, (_, i) => row(`r${i}`, i)), 200);
eq(JSON.stringify(twice), JSON.stringify(twiceB), '2. Lauf liefert identisches Ergebnis');
// markierte Zeilen sind hier schon gefiltert — Übergabe leerer Liste
eq(selectOverflow([], 200).length, 0, 'leere Liste → kein Überhang');

// ── Block 2: TTL (exakt 90 Tage, Monatsgrenze, Schaltjahr, Override)

const base = new Date('2026-01-15T12:00:00.000Z');
const exp = computeExpiresAt(base, 90);
eq(exp.toISOString(), '2026-04-15T12:00:00.000Z', 'expires_at = created_at + 90 Tage exakt');
// Monatsgrenzen
eq(computeExpiresAt(new Date('2026-01-31T00:00:00.000Z'), 90).toISOString(), '2026-05-01T00:00:00.000Z', 'Monatsgrenze Januar→Mai korrekt');
// Schaltjahr (2028)
eq(computeExpiresAt(new Date('2028-01-01T00:00:00.000Z'), 90).toISOString(), '2028-03-31T00:00:00.000Z', 'Schaltjahr 2028 korrekt');
// Override wirkt
eq(computeExpiresAt(base, 30).toISOString(), '2026-02-14T12:00:00.000Z', 'IMAGE_TTL_DAYS-Override (30) wirkt');
// genau auf der Frist GÜLTIG, +1 s abgelaufen
const at = exp.getTime();
ok(isExpired(new Date(at), at) === true, 'genau auf der Frist gilt als abgelaufen (> NOW())');
ok(isExpired(new Date(at), at - 1) === false, '1 ms vor der Frist ist gültig');
ok(isExpired(new Date(at), at + 1000) === true, '1 s nach der Frist ist abgelaufen');
ok(isExpired('kaputt', at) === true, 'unbrauchbarer Wert → fail-closed abgelaufen');
// Postgres-String-Formate (Mikrosekunden, LEERZEICHEN statt T, +00) — belegter
// Befund aus der Integrations-Suite: `new Date(...)` liefert dafür sonst NaN und
// ein GÜLTIGES Bild würde als abgelaufen (410) gelten.
eq(toEpochMs('2026-10-19 10:35:12.345678+00'), Date.parse('2026-10-19T10:35:12.345Z'), 'Microsekunden/Leerzeichen-Zeitstempel wird korrekt geparst');
ok(isExpired('2099-01-01 00:00:00.000000+00', at) === false, 'Zukunft (Postgres-Format) ist NICHT abgelaufen');
eq(toEpochMs('quatsch'), null, 'unparsbarer Zeitstempel → null');

// ── Block 3: Guard (unter/auf/über Cap, unparsbarer Env, 0/off)

const CAP = IMAGE_GLOBAL_BYTES_CAP_DEFAULT;
eq(guardDecision({ capBytes: CAP, liveBytes: CAP - 1000, newSizeBytes: 1000 }), 'ok', 'knapp unter Cap → erlaubt');
eq(guardDecision({ capBytes: CAP, liveBytes: CAP - 1000, newSizeBytes: 1001 }), 'capacity', 'ein Byte über Cap → abgelehnt');
eq(guardDecision({ capBytes: CAP, liveBytes: CAP, newSizeBytes: 0 }), 'ok', 'genau auf Cap → erlaubt (definiert)');
eq(guardDecision({ capBytes: 0, liveBytes: 10 ** 12, newSizeBytes: 10 ** 9 }), 'ok', 'Guard AUS (0) erlaubt alles');
// Env-Parsing: fail-closed
eq(resolveGlobalBytesCap(undefined), IMAGE_GLOBAL_BYTES_CAP_DEFAULT, 'leer → Default 850 MB (Guard AN)');
eq(resolveGlobalBytesCap(''), IMAGE_GLOBAL_BYTES_CAP_DEFAULT, 'leer (String) → Default');
eq(resolveGlobalBytesCap('0'), 0, '0 → Guard AUS');
eq(resolveGlobalBytesCap('off'), 0, 'off → Guard AUS');
eq(resolveGlobalBytesCap('OFF'), 0, 'OFF (Großschreibung) → Guard AUS');
eq(resolveGlobalBytesCap('1000000000'), 1_000_000_000, 'Zahl > 0 → genau dieser Wert');
eq(resolveGlobalBytesCap('acht-850'), IMAGE_GLOBAL_BYTES_CAP_DEFAULT, 'unparsbarer Wert → Default 850 MB (Schutz bleibt AN)');
eq(resolveGlobalBytesCap('-5'), IMAGE_GLOBAL_BYTES_CAP_DEFAULT, 'negativ → Default (Schutz bleibt AN)');
eq(resolveGlobalBytesCap('850 MB'), IMAGE_GLOBAL_BYTES_CAP_DEFAULT, 'Text mit Einheit → Default');
// Warnschwelle
eq(resolveGlobalWarnBytes(undefined, CAP), IMAGE_GLOBAL_WARN_BYTES_DEFAULT, 'Warnschwelle Default 700 MB');
eq(resolveGlobalWarnBytes('99999999999', CAP), CAP, 'Warnschwelle nie über dem Deckel');
ok(isGuardWarning({ capBytes: CAP, warnBytes: 700_000_000, liveBytes: 700_000_000 }) === true, 'genau 700 MB → Warnung');
ok(isGuardWarning({ capBytes: CAP, warnBytes: 700_000_000, liveBytes: 699_999_999 }) === false, 'unter 700 MB → keine Warnung');
ok(isGuardWarning({ capBytes: CAP, warnBytes: 700_000_000, liveBytes: CAP }) === false, 'auf dem Deckel → keine Warnung (schon Ablehnung)');
ok(isGuardWarning({ capBytes: 0, warnBytes: 0, liveBytes: 10 ** 9 }) === false, 'Guard AUS → keine Warnung');
eq(remainingBytes(CAP, 850_000_000), 0, 'Rest-Kapazität am Deckel = 0');
eq(remainingBytes(0, 123), Number.POSITIVE_INFINITY, 'Guard AUS → unendliche Rest-Kapazität');
// Limits aus der Umgebung
const limits = resolveImageLimits({ IMAGE_MAX_PER_USER: '50', IMAGE_TTL_DAYS: '30', IMAGE_GLOBAL_BYTES_CAP: '1000' });
eq(limits.maxPerUser, 50, 'IMAGE_MAX_PER_USER-Override');
eq(limits.ttlDays, 30, 'IMAGE_TTL_DAYS-Override');
eq(limits.globalBytesCap, 1000, 'IMAGE_GLOBAL_BYTES_CAP-Override');
eq(resolveImageLimits({}).maxPerUser, IMAGE_MAX_PER_USER_DEFAULT, 'Default 200 Bilder/Nutzer');
eq(resolveImageLimits({}).ttlDays, IMAGE_TTL_DAYS_DEFAULT, 'Default 90 Tage');

// ── Block 4: Zugriffskontrolle (200/403/404/410/401)

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
eq(imageAccessStatus({ requesterUserId: null, found: true, imageUserId: ME }), 401, 'keine Session → 401');
eq(imageAccessStatus({ requesterUserId: ME, found: true, imageUserId: ME }), 200, 'eigenes Bild → 200');
eq(imageAccessStatus({ requesterUserId: ME, found: true, imageUserId: OTHER }), 403, 'fremdes Bild → 403');
eq(imageAccessStatus({ requesterUserId: ME, found: false }), 404, 'unbekannte id → 404');
eq(imageAccessStatus({ requesterUserId: ME, found: true, imageUserId: ME, expired: true }), 410, 'abgelaufen → 410');
eq(imageAccessStatus({ requesterUserId: ME, found: true, imageUserId: ME, deleted: true }), 410, 'gelöscht → 410');
eq(imageAccessStatus({ requesterUserId: ME, found: true, imageUserId: OTHER, expired: true }), 403, 'fremd + abgelaufen → 403 (kein Leak)');
eq(imageAccessStatus({ requesterUserId: null, found: false }), 401, 'ohne Session hat 401 Vorrang vor 404');

// ── Block 5: Cron-Auth (fail-closed)

const SECRET = 'a'.repeat(32);
ok(cronAuthOk({ secret: SECRET, authorization: `Bearer ${SECRET}` }) === true, 'richtiger Bearer → erlaubt');
ok(cronAuthOk({ secret: SECRET, authorization: 'Bearer falsch' }) === false, 'falscher Bearer → 401');
ok(cronAuthOk({ secret: SECRET, authorization: null }) === false, 'kein Header → 401');
ok(cronAuthOk({ secret: undefined, authorization: `Bearer ${SECRET}` }) === false, 'kein CRON_SECRET gesetzt → IMMER 401');
ok(cronAuthOk({ secret: '', authorization: 'Bearer ' }) === false, 'leeres Secret → 401');
ok(cronAuthOk({ secret: SECRET, authorization: `bearer ${SECRET}` }) === false, 'falsche Schreibweise → 401');

// ── Block 6: Daten-URL, Pfade, Prompt-Kappung, Löschgrund-Whitelist

// 1x1 PNG
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const decoded = decodeImageDataUrl(`data:image/png;base64,${pngB64}`);
ok(decoded !== null, 'PNG-Daten-URL wird dekodiert');
ok(decoded !== null && decoded.bytes.length > 0, 'dekodierte Bytes sind nicht leer');
eq(decoded?.mimeType, 'image/png', 'MIME-Typ aus der Daten-URL');
ok(decodeImageDataUrl('data:image/jpg;base64,QUJD')?.mimeType === 'image/jpeg', 'image/jpg wird zu image/jpeg normalisiert');
ok(decodeImageDataUrl(`data:text/html;base64,${pngB64}`) === null, 'fremder MIME-Typ → null (fail-closed)');
ok(decodeImageDataUrl('https://example.com/x.png') === null, 'echte URL statt Daten-URL → null');
ok(decodeImageDataUrl(undefined) === null, 'undefined → null');
ok(decodeImageDataUrl('data:image/png;base64,!') === null, 'kaputte Base64 → null');
eq(buildBlobPath(ME, 'abc'), `images/${ME}/abc`, 'Blob-Pfad deterministisch images/<uuid>/<id>');
eq(blobPrefixForUser(ME), `images/${ME}/`, 'Pfad-Präfix für den Orphan-Check');
eq(capPrompt('  hallo  '), 'hallo', 'Prompt wird getrimmt');
eq(capPrompt(''), null, 'leerer Prompt → null');
eq(capPrompt(undefined), null, 'fehlender Prompt → null');
eq(capPrompt('x'.repeat(500))?.length, 400, 'Prompt auf 400 Zeichen gekappt');
eq(normalizeProjectId('  '), null, 'leere Projekt-ID → null');
eq(normalizeProjectId('p1'), 'p1', 'Projekt-ID bleibt');
ok(isValidDeleteReason('cap_200') && isValidDeleteReason('ttl_90d') && isValidDeleteReason('account_deleted') && isValidDeleteReason('manual'), 'alle 4 Löschgründe erlaubt');
ok(!isValidDeleteReason('project_cleanup'), "Löschgrund 'project_cleanup' ist NICHT erlaubt (Projekt-Löschung löscht nie Bilder)");
ok(!isValidDeleteReason('irgendwas'), 'freier Löschgrund ist nicht erlaubt');
eq(formatBytes(850_000_000), '850 MB', 'Byte-Anzeige 850 MB');
eq(formatBytes(2_100_000), '2.1 MB', 'Byte-Anzeige 2.1 MB');
eq(formatBytes(500_000), '500 KB', 'Byte-Anzeige 500 KB');
eq(parsePositiveInt('200'), 200, 'parsePositiveInt Zahl');
eq(parsePositiveInt('0'), null, 'parsePositiveInt 0 → null');
eq(parsePositiveInt('x'), null, 'parsePositiveInt Text → null');

// ── Block 7: Zähl-Semantik (statisch: die Module importieren keinen KI-Pfad)

const serviceSrc = await Bun.file('./src/lib/generated-images-service.ts').text();
ok(!serviceSrc.includes('usage-guard'), 'Service importiert NICHT usage-guard (0 Generierungen für Speichern/Lesen/Löschen)');
ok(!serviceSrc.includes('withGenerationGuard'), 'Service ruft withGenerationGuard nie auf');
ok(!serviceSrc.includes('recordGeneration'), 'Service ruft recordGeneration nie auf');
ok(!serviceSrc.includes('.list(') || serviceSrc.includes('orphanCheck'), 'kein list() im Hot Path (nur im Orphan-Check)');
const streamSrc = await Bun.file('./src/api/image-stream.ts').text();
ok(streamSrc.includes('saveGeneratedImage'), 'SSE-Route speichert nach dem Endbild (Stream-Pfad eingebunden)');
ok(streamSrc.indexOf('saveGeneratedImage') > streamSrc.indexOf('withGenerationGuard'), 'Speicherung liegt innerhalb/ nach der Quota-Kette');
const cronSrc = await Bun.file('./src/api/cron-blob-ttl.ts').text();
ok(cronSrc.includes('cronAuthOk'), 'Cron-Route nutzt den fail-closed-Auth-Helfer');
ok(
  ['marked', 'blobDeleted', 'blobFailed', 'rowsDeleted'].every((k) => cronSrc.includes(`${k}: result.${k}`)),
  'Cron-Antwort hat den Belegkörper { marked, blobDeleted, blobFailed, rowsDeleted }',
);

// ── Ergebnis

console.log('');
console.log(`Checks: ${checks} · bestanden: ${checks - failed} · fehlgeschlagen: ${failed}`);
if (failed > 0) {
  console.error('FEHLGESCHLAGEN:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('PASS generated-images-logic-test');

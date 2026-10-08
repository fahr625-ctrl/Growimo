/**
 * Stabilisierung Phase 4.1 — Navigation/History deterministisch (C6/A7).
 *
 * Prüft (a) die reinen Lifecycle-/Cache-Funktionen aus
 * `src/lib/navigation-lifecycle.ts` und (b) die Verdrahtung in `routes/app.tsx`
 * und `components/ProtectedRoute.tsx` (Quelltext-Assertions, damit die
 * Verhaltensregeln nicht still verschwinden).
 *
 * Ausführen:  bun stabilisierung-phase41-test.ts
 */
import { readFileSync } from 'node:fs';
import {
  BETA_ACCESS_CACHE_KEY,
  BETA_ACCESS_CACHE_TTL_MS,
  BETA_ACCESS_CACHE_VERSION,
  clearBetaAccessCache,
  decodeBetaAccessEntry,
  encodeBetaAccessEntry,
  isBfcacheReturn,
  readBetaAccessCache,
  shouldKeepBetaState,
  shouldRecheckOnReturn,
  writeBetaAccessCache,
} from './src/lib/navigation-lifecycle';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log('PASS:', name);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
    console.log('FAIL:', name, detail ? `— ${detail}` : '');
  }
}

console.log('\n── 4.1 bfcache-Guard ────────────────────────────────────────────');
{
  check('pageshow mit persisted=true → bfcache-Rückkehr', isBfcacheReturn({ persisted: true }) === true);
  check('pageshow mit persisted=false (normale Ladung) → keine Rückkehr', isBfcacheReturn({ persisted: false }) === false);
  check('fehlendes Event → keine Rückkehr (fail-safe)', isBfcacheReturn(undefined) === false && isBfcacheReturn(null) === false);
  check('Gate-Zustand bleibt bei bfcache-Rückkehr erhalten', shouldKeepBetaState({ persisted: true }) === true);
  check('ohne bfcache wird nichts „erhalten“ (normale Prüfung läuft)', shouldKeepBetaState({ persisted: false }) === false);
  check('approved bleibt approved bei Rückkehr', shouldRecheckOnReturn({ persisted: true }, 'approved') === false);
  check('error wird bei Rückkehr neu geprüft (Timeout lief während des Einfrierens)', shouldRecheckOnReturn({ persisted: true }, 'error') === true);
  check('denied wird bei Rückkehr NICHT neu geprüft', shouldRecheckOnReturn({ persisted: true }, 'denied') === false);
  check('ohne bfcache kein Re-Check-Trigger', shouldRecheckOnReturn({ persisted: false }, 'error') === false);
}

console.log('\n── 4.1 Gate-Zustand in sessionStorage ───────────────────────────');
{
  const now = 1_800_000_000_000;
  const email = 'Beta@Example.com';

  const enc = encodeBetaAccessEntry(email, 'approved', now);
  check('Eintrag trägt Versionsfeld', JSON.parse(enc).version === BETA_ACCESS_CACHE_VERSION);
  check('E-Mail wird normalisiert gespeichert', JSON.parse(enc).email === 'beta@example.com');
  check('frischer Eintrag → approved', decodeBetaAccessEntry(enc, email, now) === 'approved');
  check('andere Schreibweise der E-Mail matcht ebenfalls', decodeBetaAccessEntry(enc, 'beta@example.com', now) === 'approved');
  check('fremde E-Mail → kein Treffer (kein Fremd-Login-Erbe)', decodeBetaAccessEntry(enc, 'other@example.com', now) === null);
  check('abgelaufener Eintrag (TTL) → null', decodeBetaAccessEntry(enc, email, now + BETA_ACCESS_CACHE_TTL_MS + 1) === null);
  check('Eintrag genau an der TTL-Grenze ist noch gültig', decodeBetaAccessEntry(enc, email, now + BETA_ACCESS_CACHE_TTL_MS) === 'approved');
  check('Eintrag aus der Zukunft (Uhr-Sprung) → null', decodeBetaAccessEntry(enc, email, now - 1000) === null);
  check('falsche Version → null (alte Formate werden ignoriert)', decodeBetaAccessEntry(JSON.stringify({ version: 0, email: 'beta@example.com', state: 'approved', at: now }), email, now) === null);
  check('denied wird nie aus dem Cache beantwortet', decodeBetaAccessEntry(encodeBetaAccessEntry(email, 'denied', now), email, now) === null);
  check('defektes JSON → null statt Absturz', decodeBetaAccessEntry('{kaputt', email, now) === null);
  check('null/leer → null', decodeBetaAccessEntry(null, email, now) === null && decodeBetaAccessEntry('', email, now) === null);
  check('leere E-Mail → null (kein Cache ohne Identität)', decodeBetaAccessEntry(enc, '', now) === null);

  // Ohne window/sessionStorage (Node/SSR) müssen alle Zugriffe sicher sein.
  check('readBetaAccessCache ohne DOM → null (SSR-sicher)', readBetaAccessCache(email, now) === null);
  check('writeBetaAccessCache ohne DOM wirft nicht', (() => { try { writeBetaAccessCache(email, 'approved', now); return true; } catch { return false; } })());
  check('clearBetaAccessCache ohne DOM wirft nicht', (() => { try { clearBetaAccessCache(); return true; } catch { return false; } })());
  check('Cache-Schlüssel ist versioniert', BETA_ACCESS_CACHE_KEY === 'growimo_beta_access_v1');
  check('TTL ist kurz (≤ 10 min, kein Dauer-Cache)', BETA_ACCESS_CACHE_TTL_MS <= 10 * 60 * 1000);
}

console.log('\n── 4.1 Verdrahtung app.tsx / ProtectedRoute.tsx ─────────────────');
{
  const app = readFileSync('./src/routes/app.tsx', 'utf8');
  // BETA-ENDE (Owner-Auftrag 2026-10-08): Das Beta-Access-Gate (Zustandsmaschine
  // checking/approved/denied/error, sessionStorage-Spiegel, pageshow-Re-Check) ist
  // bewusst ENTFERNT — die Phase-4.1-Gate-Assertions prüften damit eine entfernte
  // Funktion und sind hier 1:1 durch die neuen Invarianten ersetzt (Gesamtzahl der
  // Checks bleibt). Die Lifecycle-Helfer selbst bleiben erhalten und werden von
  // ProtectedRoute weiter genutzt (Checks unten).
  check('app.tsx hat keinen Beta-Gate-Fetch mehr', !app.includes('fetch("/api/beta-access"'));
  check('app.tsx importiert das Gate-Cache-Modul nicht mehr', !app.includes('~/lib/navigation-lifecycle'));
  check('app.tsx nutzt keinen sessionStorage-Gate-Spiegel mehr', !app.includes('readBetaAccessCache') && !app.includes('writeBetaAccessCache'));
  check('app.tsx kennt keinen „checking“-Zustand mehr', !app.includes('beta === "checking"'));
  check('app.tsx kennt keinen „denied“-Zustand (Warteliste) mehr', !app.includes('beta === "denied"'));
  check('app.tsx kennt keinen „error“-Retry-Zweig mehr', !app.includes('beta === "error"'));
  check('app.tsx hat keinen WaitlistScreen mehr', !app.includes('function WaitlistScreen'));
  check('app.tsx legt die users-Zeile für jeden eingeloggten Nutzer an', app.includes('if (!isSignedIn) return;'));
  check('app.tsx koppelt ensureUser nicht mehr an beta = approved', !app.includes('beta !== "approved"'));
  check('app.tsx rendert für Eingeloggte Sidebar + Outlet', app.includes('<AppSidebar />') && app.includes('<Outlet />'));
  check('app.tsx behält die Layout-Ausnahme für /app/beta-welcome', app.includes('if (isBetaWelcome)'));
  check('beta-welcome ist jetzt auth-geschützt (ProtectedRoute)',
    readFileSync('./src/routes/app/beta-welcome.tsx', 'utf8').includes('<ProtectedRoute>'));
  check('Landing-CTAs führen zur öffentlichen Registrierung',
    readFileSync('./src/components/LandingPage.tsx', 'utf8').includes('href="/app/sign-up"'));

  const pr = readFileSync('./src/components/ProtectedRoute.tsx', 'utf8');
  check('ProtectedRoute nutzt den bfcache-Helfer', pr.includes('isBfcacheReturn'));
  check('ProtectedRoute setzt den Langsam-Hinweis bei Rückkehr zurück', pr.includes('isBfcacheReturn(event)) setSlowLoad(false)'));
  check('ProtectedRoute räumt den Listener ab', pr.includes('window.removeEventListener("pageshow"'));
  check('ProtectedRoute-Hook steht vor dem bedingten Rendern von !isLoaded', pr.indexOf('removeEventListener("pageshow"') < pr.indexOf('if (!isLoaded)'));
  check('Phase-3.2-Timeout des Ladens unverändert vorhanden', pr.includes('AUTH_LOAD_TIMEOUT_MS = 12_000'));

  // Keine Vollseiten-Sprünge auf interne Routen (Phase 3 bereits umgestellt).
  for (const f of ['./src/routes/app/tiktok.tsx', './src/routes/app/image-studio.tsx']) {
    const src = readFileSync(f, 'utf8');
    const anchors = src.match(/<a\s[^>]*href=["']\/app/gi) ?? [];
    check(`keine <a href="/app…">-Sprünge in ${f.split('/').pop()}`, anchors.length === 0, `gefunden: ${anchors.length}`);
  }
}

console.log(`\n=== stabilisierung-phase41-test: ${passed} PASS, ${failures.length} FAIL ===`);
if (failures.length > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exitCode = 1;
}

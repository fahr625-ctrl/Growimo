// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 (Prod-Origin) — Unit-Suite für die Fallback-Kette der Rückkehr-URLs.
// ─────────────────────────────────────────────────────────────────────────────
// Usage (Repo-Wurzel, keine DB, kein Netz):
//   bun stripe-origin-test.ts
//
// Prüft die verbindliche Kette aus src/stripe/origin.ts:
//   (a) PUBLIC_SITE_URL → (b) Origin / X-Forwarded-Host / Host des Requests
//   (https erzwungen) → (c) https://www.growimo.app (NIE localhost).
// Exit-Code 0 nur wenn alle Checks grün.
// ─────────────────────────────────────────────────────────────────────────────
import {
  DEV_SITE_ORIGIN,
  PROD_SITE_ORIGIN,
  getOrigin,
  normalizeOrigin,
  originFromRequest,
  resolveOrigin,
} from './src/stripe/origin';

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

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

async function main() {
  console.log('— stripe-origin-test (Bug 1: Prod-Origin) —\n');

  // ── [1] normalizeOrigin ───────────────────────────────────────────────────
  console.log('[1] normalizeOrigin (Schema-/Host-Normalisierung, https erzwungen)');
  check(normalizeOrigin('https://www.growimo.app') === 'https://www.growimo.app', 'https-Origin bleibt unverändert');
  check(normalizeOrigin('http://www.growimo.app') === 'https://www.growimo.app', 'http → https erzwungen (nicht-lokaler Host)');
  check(normalizeOrigin('www.growimo.app') === 'https://www.growimo.app', 'nackter Host → https://host');
  check(normalizeOrigin('www.growimo.app:443') === 'https://www.growimo.app', 'Host mit Port wird normalisiert');
  check(normalizeOrigin('http://localhost:3000') === DEV_SITE_ORIGIN, 'localhost bleibt http (Dev/E2E)');
  check(normalizeOrigin('127.0.0.1:3188') === 'http://127.0.0.1:3188', '127.0.0.1 bleibt http mit Port');
  check(normalizeOrigin('https://www.growimo.app, http://evil.test') === 'https://www.growimo.app', 'X-Forwarded-Liste → erster Eintrag');
  check(normalizeOrigin('null') === null, 'Origin-String „null" → null (nicht verwertbar)');
  check(normalizeOrigin('') === null, 'leerer String → null');
  check(normalizeOrigin(null) === null, 'null → null');
  check(normalizeOrigin(undefined) === null, 'undefined → null');
  check(PROD_SITE_ORIGIN === 'https://www.growimo.app', 'Prod-Fallback ist https://www.growimo.app');
  check(!PROD_SITE_ORIGIN.includes('localhost'), 'Prod-Fallback enthält nie localhost');

  // ── [2] originFromRequest ─────────────────────────────────────────────────
  console.log('\n[2] originFromRequest (Origin → X-Forwarded-Host → Host → Request-URL)');
  check(
    originFromRequest(req('http://127.0.0.1:3188/_serverFn/x', { origin: 'https://www.growimo.app' })) === 'https://www.growimo.app',
    'Origin-Header gewinnt',
  );
  check(
    originFromRequest(req('http://127.0.0.1:3188/x', { 'x-forwarded-host': 'www.growimo.app' })) === 'https://www.growimo.app',
    'X-Forwarded-Host (Vercel-Proxy) → https erzwungen',
  );
  check(
    originFromRequest(req('http://127.0.0.1:3188/x', { host: 'www.growimo.app' })) === 'https://www.growimo.app',
    'Host-Header → https erzwungen',
  );
  check(
    originFromRequest(req('http://127.0.0.1:3188/x', { host: '127.0.0.1:3188' })) === 'http://127.0.0.1:3188',
    'lokaler Host bleibt http (Dev/E2E nutzbar)',
  );
  check(
    originFromRequest(req('http://127.0.0.1:3188/x', { origin: 'null', host: 'www.growimo.app' })) === 'https://www.growimo.app',
    'Origin „null" wird übersprungen, Host greift',
  );
  check(originFromRequest(req('https://www.growimo.app/x')) === 'https://www.growimo.app', 'ohne Header → Request-URL als letzte Quelle');
  check(originFromRequest(null) === null, 'kein Request → null');
  check(originFromRequest(undefined) === null, 'undefined-Request → null');

  // ── [3] resolveOrigin (die Kette selbst) ──────────────────────────────────
  console.log('\n[3] resolveOrigin: PUBLIC_SITE_URL → Request → www.growimo.app');
  check(
    resolveOrigin(req('http://127.0.0.1:3188/x', { origin: 'https://preview.vercel.app' }), { PUBLIC_SITE_URL: 'https://www.growimo.app' }) === 'https://www.growimo.app',
    'PUBLIC_SITE_URL gewinnt gegen den Request-Origin',
  );
  check(
    resolveOrigin(req('http://127.0.0.1:3188/x', { origin: 'https://preview.vercel.app' }), {}) === 'https://preview.vercel.app',
    'ohne Env → Request-Origin (auch Preview-Host)',
  );
  check(
    resolveOrigin(req('http://127.0.0.1:3188/x', { origin: 'https://www.growimo.app' }), { PUBLIC_SITE_URL: '' }) === 'https://www.growimo.app',
    'leere Env fällt auf den Request durch',
  );
  check(
    resolveOrigin(null, {}) === PROD_SITE_ORIGIN,
    'ohne Request und ohne Env → fester Prod-Fallback https://www.growimo.app',
  );
  check(
    !resolveOrigin(null, {}).includes('localhost'),
    'REGRESSION: kein localhost-Fallback mehr (alter Bug 1)',
  );

  // ── [4] getOrigin() außerhalb eines Requests ──────────────────────────────
  console.log('\n[4] getOrigin() ohne Request-Kontext (darf NIE localhost liefern)');
  const savedEnv = process.env.PUBLIC_SITE_URL;
  delete process.env.PUBLIC_SITE_URL;
  const noCtx = await getOrigin();
  check(noCtx === PROD_SITE_ORIGIN, `getOrigin() ohne Request-Kontext → ${PROD_SITE_ORIGIN} (tatsächlich: ${noCtx})`);
  check(!noCtx.includes('localhost'), 'getOrigin() ohne Kontext enthält kein localhost');
  process.env.PUBLIC_SITE_URL = 'https://env-override.test';
  const fromEnv = await getOrigin();
  check(fromEnv === 'https://env-override.test', `PUBLIC_SITE_URL-Override greift (tatsächlich: ${fromEnv})`);
  if (savedEnv === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = savedEnv;

  console.log(`\n=== stripe-origin-test: ${passed} PASS, ${failed} FAIL ===`);
  if (failed > 0) {
    console.log('Fehlgeschlagen:');
    for (const f of failures) console.log('  - ' + f);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Suite fehlgeschlagen (unexpected):', err);
  process.exitCode = 1;
});

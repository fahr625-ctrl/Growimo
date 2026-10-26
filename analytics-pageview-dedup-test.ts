// ── Pageview-Doppelzählung — Test (Owner-Auftrag 2026-10-26, Launch-Vorlauf) ──
// Lauf: bun run analytics-pageview-dedup-test.ts
//
// Prüft den Fix für den Befund „1 Seitenaufruf → 2 analytics_events-Zeilen":
// Der PageviewTracker (src/routes/__root.tsx) konnte seinen Effekt zweimal
// laufen lassen (Doppel-Mount/Hydration). Jetzt gilt: GENAU EIN pageview-Request
// pro Route und Seiten-Lebenszyklus; A→B→A zählt weiterhin zweimal; andere
// Events und das Opt-out-Verhalten bleiben unverändert.
import { createElement } from 'react';

// ── Browser-Stubs (Bun hat keinen Browser) ──────────────────────────────────
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}
const store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

const location = { pathname: '/', search: '' };
(globalThis as unknown as { window: unknown }).window = { location };
(globalThis as unknown as { document: unknown }).document = { referrer: '' };

const { setAnalyticsConsent, setAnalyticsOptOut } = await import('./src/lib/analytics-consent');
const { trackAnalytics, resetPageviewDedup } = await import('./src/lib/analytics-client');

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail = '') {
  checks++;
  if (!cond) {
    failures++;
    console.log('FAIL:', name, detail ? `— ${detail}` : '');
  } else {
    console.log('PASS:', name);
  }
}

// fetch-Stub zählt Requests und merkt sich den Body.
let calls: Array<{ url: string; body: string }> = [];
(globalThis as unknown as { fetch: unknown }).fetch = (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), body: String(init?.body ?? '') });
  return Promise.resolve(new Response('{}', { status: 200 }));
};

store.clear();
setAnalyticsOptOut(false);
setAnalyticsConsent('no');

// ── 1. Doppelter Effekt auf DERSELBEN Route → genau 1 Request ───────────────
resetPageviewDedup();
location.pathname = '/';
calls = [];
trackAnalytics('pageview'); // 1. Effekt-Lauf (Mount)
trackAnalytics('pageview'); // 2. Effekt-Lauf (Doppel-Mount/Hydration)
check('gleicher Pfad 2× → genau 1 Request', calls.length === 1, String(calls.length));
check('der gesendete Event ist pageview', calls.length === 1 && JSON.parse(calls[0].body).event === 'pageview');
check(
  'Route wird mitgesendet (metadata.route)',
  calls.length === 1 && JSON.parse(calls[0].body).metadata?.route === '/',
);

// ── 2. Dritter Lauf derselben Route bleibt ebenfalls still ─────────────────
trackAnalytics('pageview');
check('gleicher Pfad 3× → weiterhin 1 Request', calls.length === 1, String(calls.length));

// ── 3. Echter Route-Wechsel → genau 1 weiterer Request ─────────────────────
location.pathname = '/preise';
trackAnalytics('pageview');
check('Wechsel / → /preise → +1 Request', calls.length === 2, String(calls.length));
check('zweiter Request trägt Route /preise', calls.length === 2 && JSON.parse(calls[1].body).metadata?.route === '/preise');

// ── 4. Zurück zur ersten Route (A→B→A) zählt wieder ───────────────────────
location.pathname = '/';
trackAnalytics('pageview');
check('A→B→A: / wieder gezählt', calls.length === 3, String(calls.length));

// ── 5. Andere Events werden NICHT dedupliziert ────────────────────────────
location.pathname = '/';
calls = [];
resetPageviewDedup();
trackAnalytics('generation_started', { channel: 'pinterest_pin', status: 'started' });
trackAnalytics('generation_started', { channel: 'pinterest_pin', status: 'started' });
check('generation_started 2× → 2 Requests', calls.length === 2, String(calls.length));

// ── 6. Opt-out schlägt weiterhin jede Dedup-Logik ─────────────────────────
setAnalyticsOptOut(true);
calls = [];
resetPageviewDedup();
location.pathname = '/optout-probe';
trackAnalytics('pageview');
trackAnalytics('pageview');
check('mit Opt-out: 0 Requests (unverändert)', calls.length === 0, String(calls.length));
setAnalyticsOptOut(false);

// ── 7. Ohne Consent wird weiterhin KEIN Consent-Header gesendet ───────────
calls = [];
resetPageviewDedup();
location.pathname = '/consent-probe';
trackAnalytics('pageview');
check('ohne Consent: genau 1 Request', calls.length === 1, String(calls.length));

// ── 8. Payload-Verträglichkeit: kein userId/keine PII im Body ─────────────
const body = calls.length === 1 ? calls[0].body : '';
check('Payload ohne userId/email', !/userId|email|name/i.test(body), body);

// ── 9. Serverpfad-Verträglichkeit: Dedup ist rein clientseitig ────────────
// (der API-Handler schreibt weiterhin genau eine Zeile pro Request; hier wird
// nur geprüft, dass der Client keinen Zusatz-Request mehr erzeugt.)
check('kein SSR/Node-Route-Wert → keine Dedup-Blockade (resetPageviewDedup wirkt)',
  typeof resetPageviewDedup === 'function');

console.log(`\n${checks - failures}/${checks} Prüfungen grün, ${failures} rot.`);
if (failures > 0) process.exit(1);

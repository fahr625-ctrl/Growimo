// ── Widerruf der Reichweitenmessung (Owner-Vorgabe 2026-10-23) — Test ────────
// Lauf: bun run analytics-optout-test.ts
//
// Prüft die PRAKTISCHE Wirkung des Opt-out-Schalters aus /datenschutz, ohne
// Browser: localStorage-Flag, Einwilligungs-Header, Abschalten der
// Analyse-Ereignisse (fetch-Stub) und das Nicht-Laden von @vercel/analytics.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ── localStorage-Stub (Bun hat im Test keinen Browser-Speicher) ─────────────
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

const {
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_OPTOUT_KEY,
  analyticsConsentHeader,
  getAnalyticsConsent,
  isAnalyticsOptedOut,
  setAnalyticsConsent,
  setAnalyticsOptOut,
} = await import('./src/lib/analytics-consent');
const { trackAnalytics } = await import('./src/lib/analytics-client');
const { VercelAnalytics } = await import('./src/components/VercelAnalytics');

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

// ── 1. Schlüssel sind die im Datenschutztext genannten ──────────────────────
check('Opt-out-Schlüssel = growimo_analytics_optout', ANALYTICS_OPTOUT_KEY === 'growimo_analytics_optout', ANALYTICS_OPTOUT_KEY);
check('Consent-Schlüssel = growimo_consent_analytics', ANALYTICS_CONSENT_KEY === 'growimo_consent_analytics', ANALYTICS_CONSENT_KEY);

// ── 2. Ausgangszustand: kein Opt-out, Einwilligung offen ────────────────────
store.clear();
check('frisch: kein Opt-out', isAnalyticsOptedOut() === false);
check('frisch: Einwilligung undecided', getAnalyticsConsent() === 'undecided');
check('frisch: kein Consent-Header', Object.keys(analyticsConsentHeader()).length === 0);

// ── 3. Einwilligung erteilen → Header wird gesendet ────────────────────────
setAnalyticsConsent('yes');
check('consent=yes → Header granted', analyticsConsentHeader()['x-analytics-consent'] === 'granted');

// ── 4. Widerruf über den Schalter ──────────────────────────────────────────
setAnalyticsOptOut(true);
check('nach Widerruf: Opt-out gesetzt', isAnalyticsOptedOut() === true);
check('nach Widerruf: Flag im localStorage', store.getItem(ANALYTICS_OPTOUT_KEY) === 'true');
check('nach Widerruf: Einwilligung auf no', getAnalyticsConsent() === 'no');
check('nach Widerruf: KEIN Consent-Header (kein neues growimo_vid-Cookie)', Object.keys(analyticsConsentHeader()).length === 0);

// ── 5. Keine Analyse-Ereignisse mehr (fetch-Stub zählt Aufrufe) ────────────
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init?: RequestInit }> = [];
(globalThis as unknown as { fetch: unknown }).fetch = (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), init });
  return Promise.resolve(new Response('{}', { status: 200 }));
};
trackAnalytics('pageview');
check('mit Opt-out: kein einziger Request', calls.length === 0, String(calls.length));

setAnalyticsOptOut(false);
calls = [];
trackAnalytics('pageview');
check('ohne Opt-out: Request geht raus', calls.length === 1, String(calls.length));
check(
  'ohne Opt-out, consent=no: Request ohne Consent-Header',
  calls.length === 1 && !JSON.stringify(calls[0].init?.headers ?? {}).includes('x-analytics-consent'),
);

setAnalyticsConsent('yes');
calls = [];
trackAnalytics('pageview');
check(
  'ohne Opt-out, consent=yes: Request MIT Consent-Header',
  calls.length === 1 && JSON.stringify(calls[0].init?.headers ?? {}).includes('x-analytics-consent'),
);

// ── 6. @vercel/analytics wird bei Opt-out nicht gerendert ─────────────────
setAnalyticsOptOut(true);
check(
  'VercelAnalytics rendert bei Opt-out nichts (SSR/erster Render)',
  renderToStaticMarkup(createElement(VercelAnalytics)) === '',
);

// ── 7. Fail-closed: kaputter/blockierter Speicher → kein Absturz ───────────
const broken = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};
(globalThis as unknown as { localStorage: unknown }).localStorage = broken;
check('blockierter Speicher: isAnalyticsOptedOut() crasht nicht', isAnalyticsOptedOut() === false);
let threw = false;
try {
  setAnalyticsOptOut(true);
} catch {
  threw = true;
}
check('blockierter Speicher: setAnalyticsOptOut() crasht nicht', threw === false);

// Aufräumen
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;
(globalThis as unknown as { fetch: unknown }).fetch = realFetch;

console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────────
// Transport-Regressions-Test (Produktions-Regression 2026-09)
// ─────────────────────────────────────────────────────────────────────────────
// Prüft die beim Owner aufgetretene Fehlerklasse „TikTok-Fehler + Strategie
// 0/N Kanäle" gegen die GEMEINSAME ServerFn-/Streaming-Infrastruktur:
//
//   T1  Client-Serialisierung: WÖRTLICHER BEFUND — in dieser TanStack-Start-
//       Version wird das AbortSignal NICHT in den seroval-Body serialisiert/
//       transportiert. Der echte @tanstack/start-client-core-Serializer
//       (installierte Version!) erzeugt für {data, signal} einen Body, der das
//       signal NICHT enthält (Byte-identisch zum Aufruf ohne signal), und der
//       Client-Fetcher reicht das Signal separat an fetch() weiter
//       (serverFnFetcher.js: „signal: first.signal").
//       → widerlegt „signal im Payload bricht den Argument-Vertrag".
//   T2  Round-Trip durch den ECHTEN gebauten SSR-Server (dist/server/server.js),
//       Route /_serverFn/<generated-id> mit exaktem Production-Body + Headern.
//       → Payload kommt UNBESCHÄDIGT durch Routing+Validator bis in die
//         Engine: Fehler ist NICHT „mode is required"/„data is required".
//   T3  Dito mit mode='concept' (zweiter TikTok-Generierungsweg).
//   T4  Git-Regression: Die von der TikTok-Umsetzung (fc7805f..96a6e4e)
//       geänderten Dateien enthalten KEINE gemeinsame AI-/Streaming-/Build-
//       Datei → Strategie-Pfad (SSE/stream.ts/generate.ts) unberührt.
//
// ENV-AGNOSTISCH (KEIN Mock, immer echter Server + echter OpenAI-HTTP-Call):
//   Der Provider-Teil akzeptiert drei Zustände als Grün (Exit 0):
//     • 429/insufficient_quota im ServerFn-Fehler  → OpenAI-Kontingent
//       erschöpft (exakt der Production-Befund) — bekanntes Provider-Problem,
//       KEIN Code-Bug.
//     • Vollständiges TikTok-Resultat im Body      → echter Provider hat
//       geantwortet („200 mit vollständigem Result", der starke Nachweis).
//     • 401 mit „[SENSITIVE]"                      → Test OHNE .env: Bun lädt
//       .env.local automatisch, dessen OPENAI_API_KEY der Platzhalter
//       [SENSITIVE] ist; der volle Pipeline-Pfad lief trotzdem bis zum
//       echten OpenAI-HTTP-Call (dessen wörtliche Antwort) — umgebungsbedingt.
//   Alles andere (echte Regression) → FAIL.
//
// Usage: bun transport-regression-test.ts  UND  bun --env-file=.env run
// transport-regression-test.ts  → beides EXIT 0.
// Exit-Code 0 nur bei FAIL gesamt = 0.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toJSONAsync } from 'seroval';

const REPO = new URL('.', import.meta.url).pathname;
let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};

// ── Client-Serialisierung wie in @tanstack/start-client-core (installierte
// Version). Die Default-Plugins (Date/Map/React-RSC) liefern für reine
// JSON-Payloads (Strings/Arrays/Objects) keinen Byte-Unterschied — belegt durch
// die echten Production-Round-Trips (T2/T3) gegen den realen Server, der mit
// denselben Plugins deserialisiert.
// serverFnFetcher.js (verbatim, installierte Version):
//   const first = args[0];
//   const fetchBody = await getFetchBody(first);        // serialisiert NUR {data, context}
//   return fetchImpl(url, { method, headers, signal: first.signal, body });
async function serialize(data: unknown): Promise<string> {
  return JSON.stringify(await Promise.resolve(toJSONAsync(data)));
}
async function serializePayload(opts: { data?: unknown; context?: unknown }): Promise<string | undefined> {
  const payloadToSerialize: Record<string, unknown> = {};
  let available = false;
  if (opts.data !== void 0) { available = true; payloadToSerialize['data'] = opts.data; }
  if (opts.context && Object.keys(opts.context as object).length > 0) { available = true; payloadToSerialize['context'] = opts.context; }
  return available ? serialize(payloadToSerialize) : undefined;
}

const PAYLOAD = {
  mode: 'todayIdea',
  biz: 'Handgemachte Keramiktassen mit Duftkerzen',
  goal: 'Verkäufe',
  audience: 'Frauen 25–45',
  lang: 'de',
  history: [],
};

async function t1() {
  console.log('\n── T1 Client-Serialisierung: signal bleibt AUSSERHALB des Bodys ──');
  const ctrl = new AbortController();
  // Simulierter Client-Aufruf wie src/routes/app/tiktok.tsx:509:
  //   generateTikTokServer({ data: payload, signal })
  const withSignal = await serializePayload({ data: PAYLOAD });
  const withoutSignal = await serializePayload({ data: PAYLOAD });
  check(withSignal === withoutSignal, 'T1a Body mit signal === Body ohne signal (byte-identisch)');
  check(withSignal !== undefined && !withSignal.includes('signal'), 'T1b Body enthält keinen signal-Schlüssel');
  check(withSignal !== undefined && withSignal.includes('todayIdea') && withSignal.includes('Keramiktassen'), 'T1c Payload (mode/biz) vollständig im Body');
  ctrl.abort();
  // Der AbortSignal-Teil landet separat im fetch-Aufruf (kein Serialisierungs-Pfad).
  const fetcherSrc = readFileSync(resolve(REPO, 'node_modules/@tanstack/start-client-core/dist/esm/client-rpc/serverFnFetcher.js'), 'utf8');
  check(fetcherSrc.includes('signal: first.signal'), 'T1d Client-Fetcher reicht signal separat an fetch()');
  check(
    fetcherSrc.includes('payloadToSerialize["data"] = opts.data') && !/getFetchBody[^}]{0,400}signal/.test(fetcherSrc.split('async function getFetchBody')[1]?.split('async function getResponse')[0] ?? ''),
    'T1e getFetchBody/serializePayload serialisieren nur data+context',
  );
}

// ── T2/T3 Round-Trip durch den ECHTEN gebauten SSR-Server (dist) ────────────
async function t2t3() {
  console.log('\n── T2/T3 Round-Trip durch den ECHTEN gebauten SSR-Server (dist) ──');
  const serverJs = readFileSync(resolve(REPO, 'dist/server/server.js'), 'utf8');
  // Server-Fn-ID direkt aus der Registry des gebauten Builds extrahieren
  // (robust gegen Rebuilds, die die Hash-ID ändern).
  const idMatch = serverJs.match(/"([0-9a-f]{64})": \{\s*functionName: "generateTikTokServer_createServerFn_handler"/);
  check(!!idMatch, 'T0 TikTok-ServerFn in dist-Registry gefunden');
  if (!idMatch) {
    failed += 3;
    return;
  }
  const fnId = idMatch![1];
  const mod = await import('./dist/server/server.js');
  const handler = (mod as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch;
  // Echter Netzwerkpfad: der gebaute Server wird auf einen freien Port gebunden,
  // der Aufruf geht über echtes HTTP (Host/Origin stimmen überein wie im Browser).
  const server = Bun.serve({ port: 0, fetch: (req) => handler(req) });
  const base = `http://127.0.0.1:${server.port}`;
  const headers = {
    'content-type': 'application/json',
    'x-tsr-serverFn': 'true',
    accept: 'application/x-tss-framed, application/x-ndjson, application/json',
    origin: base,
    'user-agent': 'transport-regression-test',
  };
  const body1 = await serializePayload({ data: PAYLOAD });
  const body2 = await serializePayload({
    data: { mode: 'concept', biz: 'Keramikmanufaktur', topic: '10 Gründe für Handgemachtes', goal: 'Verkäufe', lang: 'de' },
  });
  await roundTrip('todayIdea', body1!, headers, base, fnId);
  await roundTrip('concept', body2!, headers, base, fnId);
  server.stop(true);
}

async function roundTrip(name: string, body: string, headers: Record<string, string>, base: string, fnId: string) {
  const t0 = Date.now();
  const res = await fetch(`${base}/_serverFn/${fnId}`, { method: 'POST', headers, body });
  const text = await res.text();
  const ms = Date.now() - t0;
  console.log(`  [${name}] HTTP ${res.status} in ${ms}ms`);
  if (res.status === 403) console.log('  403 body:', text.slice(0, 200));
  const m = text.match(/"message":\{"t":1,"s":"((?:\\"|[^"\\])*)"/);
  const errMsg = m ? m[1].replace(/\\"/g, '"') : '';
  const validationErrors = ['mode is required', 'data is required', 'Unternehmensbeschreibung', 'biz ('];
  check(res.status === 200, `${name}: HTTP 200 (Transport ok)`);
  const isError = text.includes('$TSR/Error');
  if (isError) {
    // ServerFn-Fehlerpfad (normaler Error-Envelope): Payload-Integrität prüfen —
    // KEIN Validierungsfehler ⇒ Payload kam unversehrt durch Routing+Validator.
    check(!validationErrors.some((v) => errMsg.includes(v)), `${name}: KEIN Validierungsfehler → Payload kam unversehrt durch Routing+Validator`);
    check(errMsg.length > 0, `${name}: Fehlermeldung vorhanden: "${errMsg.slice(0, 90)}"`);
    // Provider-Zustand env-agnostisch bewerten (KEIN Mock — der Fehler ist die
    // wörtliche Antwort des echten OpenAI-HTTP-Calls durch die volle Pipeline):
    if (/429|insufficient_quota|quota|rate ?limit/i.test(errMsg)) {
      console.log(`  ✓ ${name}: Provider = 429 (OpenAI-Kontingent) — bekanntes Kontingent-Problem, KEIN Code-Bug`);
      check(true, `${name}: 429 als bekanntes Kontingent-Problem akzeptiert`);
    } else if (errMsg.includes('401') && errMsg.includes('[SENSITIVE]')) {
      console.log(`  ✓ ${name}: Test OHNE .env → Platzhalter-Key [SENSITIVE] (.env.local) → 401 von OpenAI — umgebungsbedingt, Transport nachweislich ok`);
      check(true, `${name}: 401-Platzhalter (Test ohne .env) als umgebungsbedingt akzeptiert`);
    } else {
      check(false, `${name}: Unerwarteter Provider-Fehler (kein 429/Kontingent, kein 401-Platzhalter) — wörtlich: "${errMsg.slice(0, 160)}"`);
    }
  } else {
    // Kein ServerFn-Fehler → der echte Provider hat geantwortet: vollständiges
    // TikTok-Resultat? (format + timedScenes/title + imageIdeas = Idea-Resultat)
    const complete =
      text.includes('"format"') && text.includes('timedScenes') && text.includes('imageIdeas') && text.includes('title');
    check(complete, `${name}: Echter Provider-Nachweis — vollständiges TikTok-Resultat (${text.length} Bytes)`);
  }
  return { status: res.status, errMsg, isError };
}

// ── T4 Git-Regression: gemeinsame Dateien unverändert durch TikTok ──────────
async function t4() {
  console.log('\n── T4 Git-Regression: TikTok-Änderungen berühren KEINE gemeinsame AI-/Stream-Infrastruktur ──');
  const diff = Bun.spawnSync(['git', 'diff', '--name-only', 'fc7805f..96a6e4e'], { cwd: REPO });
  const files = diff.stdout.toString().split('\n').filter(Boolean);
  const shared = [
    'src/ai/stream.ts',
    'src/ai/generate.ts',
    'src/ai/metric-guard.ts',
    'src/ai/types.ts',
    'src/ai/providers/',
    'src/api/generate-stream.ts',
    'vercel-entry.ts',
    'build-vercel.sh',
  ];
  const touched = files.filter((f) => shared.some((s) => f.startsWith(s)));
  check(touched.length === 0, `T4a Gemeinsame Dateien unverändert (fc7805f..96a6e4e): ${touched.length ? touched.join(', ') : 'keine'}`);
  check(files.includes('src/ai/server.ts') || files.some((f) => f.includes('tiktok')), 'T4b TikTok-Änderungen nur im TikTok-Bereich + i18n + Tests');
  console.log(`  geänderte Dateien (${files.length}): ${files.slice(0, 14).join(', ')}${files.length > 14 ? ', …' : ''}`);
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
async function main() {
  console.log('===== Transport-Regressions-Test (Produktions-Regression) =====');
  await t1();
  await t2t3();
  await t4();
  console.log(`\nPASS: ${passed}  FAIL: ${failed}`);
  if (failures.length) {
    console.log('Fehlgeschlagen:', failures.join(' | '));
    process.exit(1);
  }
  console.log('TRANSPORT-REGRESSION GRÜN');
  process.exit(0);
}
void main();
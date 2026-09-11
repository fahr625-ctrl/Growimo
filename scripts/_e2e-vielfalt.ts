// E2E-Evidenz vs. PRODUCTION (www.growimo.app): todayIdea Vielfalt — GENAU 3 Calls,
// OHNE Themen-Eingabe, nacheinander, mit client-identischer Richtungs-Rotation
// (previousDirection = pickTodayIdeaDirection(prev), identisch zur App in
// src/routes/app/tiktok.tsx). Kein Mock: echter Clerk-Token, echter OpenAI-Call.
// Nutzung: bun --env-file=.env run scripts/_e2e-vielfalt.ts
import { toJSONAsync } from 'seroval';
import { pickTodayIdeaDirection } from '../src/lib/tiktok-directions';

const BASE = 'https://www.growimo.app';
const FS = await import('fs');
const JWT = FS.readFileSync('/home/team/shared/e2e/session-jwt.txt', 'utf8').trim();
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const TIKTOK_FN = 'c5a06ea39a783ee8b3870581fdd275a061a938a0f2f2e936944df44a51caba3c'; // generateTikTokServer
const headers = (extra: Record<string, string> = {}) => ({
  'user-agent': UA, origin: BASE, 'x-tsr-serverFn': 'true',
  cookie: `__session=${JWT}`, ...extra,
});

// ── seroval-AST → JS ─────────────────────────────────────────────────────────
function toJS(n: any): any {
  if (!n || typeof n !== 'object') return n;
  if (n.t === 1) return n.s;
  if (n.t === 9) return (n.a ?? []).map(toJS);
  if (n.t === 10) {
    const o: Record<string, any> = {};
    const k: string[] = n.p?.k ?? []; const v: any[] = n.p?.v ?? [];
    k.forEach((key, i) => { o[key] = toJS(v[i]); });
    return o;
  }
  if (n.t === 3) return n.b;
  if (n.t === 2) return n.n;
  return n;
}

// ── Selbstreferenz-Check (analog SELF_REFERENCE_PATTERNS, grob) ──────────────
const SELFREF_MARKERS = [
  /\bKann Growimo/i, /\bcan\s+growimo/i, /\bkann eine ki/i, /\bcan an ai/i,
  /\btesten?\s+wir\s+unser/i, /\bunser\s+eigenes?\s+(produkt|app)\s+(testen|ausprobieren)/i,
  /\btest\s+our\s+own\s+(product|app)/i,
  /\bwie\s+gut\s+(ist|sind|kann)\s+(mein|meine|unser|unsere)/i,
  /\bhow\s+good\s+(is|are|can)\s+(my|our)/i,
  /\bwas\s+kann\s+(growimo|unser)/i, /\bwhat\s+can\s+(growimo|our)/i,
];

function collectStrings(v: any, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

// ── Payload-Basis (todayIdea OHNE Themen-Eingabe, wie im Auftrag) ────────────
const BASE_PAYLOAD = {
  mode: 'todayIdea',
  biz: 'Handgemachte Keramiktassen mit Duftkerzen, nachhaltiger Ton, 29 EUR',
  goal: 'Verkäufe',
  audience: 'Frauen 25–45, Interior-Liebhaberinnen',
  lang: 'de',
  history: [] as string[],
};

async function callOnce(label: string, previousDirection: string | undefined, rawFile: string) {
  const payload: Record<string, unknown> = { ...BASE_PAYLOAD };
  if (previousDirection !== undefined) payload.previousDirection = previousDirection;
  const body = JSON.stringify(await toJSONAsync({ data: payload }));
  const t0 = Date.now();
  const res = await fetch(`${BASE}/_serverFn/${TIKTOK_FN}`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json', accept: 'application/x-tss-framed, application/x-ndjson, application/json' }),
    body,
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  FS.writeFileSync(rawFile, text);
  const parsed = res.status === 200 ? toJS(JSON.parse(text)) : null;
  const result = parsed?.result ?? null;
  const idea: Record<string, any> = result ?? {};
  // Selbstreferenz-Scan über alle String-Felder der Antwort
  const selfRefHits = collectStrings(parsed).filter((s) => SELFREF_MARKERS.some((re) => re.test(s)));
  console.log(`\n========== ${label} ==========`);
  console.log(`HTTP ${res.status} in ${ms}ms | len=${text.length} | previousDirection=${previousDirection ?? '(keine)'}`);
  console.log(`FORMAT:        ${idea.format ?? '(kein format-Feld)'}`);
  console.log(`TITEL/IDEE:    ${idea.title ?? idea.idea ?? '(kein Titel)'}`);
  console.log(`HOOK:          ${idea.hook ?? '(kein hook)'}`);
  console.log(`CAPTION:       ${(idea.caption ?? '').slice(0, 220)}`);
  console.log(`LÄNGE:         ${idea.length ?? '?'} | CTA: ${idea.cta ?? ''}`);
  console.log(`selfCheck:     ${JSON.stringify(idea.selfCheck ?? null)}`);
  console.log(`SELBSTREF-HITS: ${selfRefHits.length === 0 ? 'KEINE' : JSON.stringify(selfRefHits)}`);
  console.log(`RAW_FILE:      ${rawFile}`);
  return { status: res.status, result: idea, selfRefHits, ms, parsed };
}

// ── GENAU 3 Calls, nacheinander, client-identische Rotation ──────────────────
// Client (tiktok.tsx): prev = localStorage(TIKTOK_LAST_DIRECTION_KEY);
// nach Erfolg: localStorage.setItem(KEY, pickTodayIdeaDirection(prev)).
let prev: string | undefined = undefined; // Call 1: Browser hat (noch) keinen Eintrag
const c1 = await callOnce('Call 1 (ohne Themen-Eingabe)', prev, '/home/team/shared/e2e/vielfalt-call1.json');
prev = pickTodayIdeaDirection(prev); // Browser speichert nach Erfolg dieselbe Funktion
const c2 = await callOnce('Call 2 (ohne Themen-Eingabe)', prev, '/home/team/shared/e2e/vielfalt-call2.json');
prev = pickTodayIdeaDirection(prev);
const c3 = await callOnce('Call 3 (ohne Themen-Eingabe)', prev, '/home/team/shared/e2e/vielfalt-call3.json');

const titles = [c1.result?.title ?? c1.result?.idea, c2.result?.title ?? c2.result?.idea, c3.result?.title ?? c3.result?.idea];
const formats = [c1.result?.format, c2.result?.format, c3.result?.format];
const allOk = [c1, c2, c3].every((c) => c.status === 200 && c.result && (c.result.title || c.result.idea) && c.result.format);
const distinctTitles = new Set(titles.map((t) => String(t ?? '').trim()));
const noSelfRef = [c1, c2, c3].every((c) => c.selfRefHits.length === 0);
console.log('\n========== FAZIT ==========');
console.log(`3x HTTP 200 + vollständiges Konzept: ${allOk ? 'JA' : 'NEIN'}`);
console.log(`unterschiedliche Titel/Themen (${distinctTitles.size}/3): ${distinctTitles.size >= 2 ? 'JA (keine direkte Wiederholung)' : 'NEIN'}`);
console.log(`Formate: ${JSON.stringify(formats)}`);
console.log(`Selbstreferenz-frei: ${noSelfRef ? 'JA' : 'NEIN'}`);
process.exit(allOk && distinctTitles.size >= 2 && noSelfRef ? 0 : 1);
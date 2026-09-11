// ─────────────────────────────────────────────────────────────────────────────
// TikTok-Modul — Konsolidierte Test-Suite (Phase 1–5)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (aus der Repo-Wurzel):
//   bun tiktok-test.ts
//
// Führt aus:
//   [1–4] Die vier Phasen-Testsätze als Subprozesse (tiktok-phase{1,2,3,4}-test.ts)
//         — Regressionen Phase 1–4 bleiben grün; PASS/FAIL-Zähler je Datei.
//   [5]   Härtungstests (in-process, OpenAI-Mock, KEIN .env, KEINE echte DB):
//         H1  Client-Abbruch (Button) → kein Hänger, ehrlicher Abbruch-Fehler
//         H2  Client-Timeout (~90 s Default; Test mit 120 ms) → sauberer Fehler
//         H3  Retry-Budget ausgeschöpft → ehrlicher Fehler nach max. 4 Versuchen
//         H4  Server-Timeout, Signal VOR dem Call abgebrochen → ehrliche Meldung,
//             kein LLM-Call
//         H5  Server-Timeout WÄHREND des LLM-Calls (Mock hängt) → saubere Meldung
//             durch AbortSignal (OpenAI-SDK ehrt das Signal)
//         H6  Happy Path mit Signal → Signal-Param verschlechtert nichts
//         H7  i18n de/en-Parität aller tiktok_*-Keys (inkl. Phase-4/5-Keys)
//         H8  Server-Handler-Wiring (TIKTOK_TIMEOUT_MS/AbortController)
//         H9  Client-Wiring (Guard, Abort-Button, Timeout-Meldungen)
//         H10 Client-Timeout-Konfiguration (90 s)
// Exit-Code 0 nur, wenn alle Sätze grün (FAIL gesamt = 0).
// ─────────────────────────────────────────────────────────────────────────────
import { generateTikTok } from './src/ai/tiktok';
import { guardTikTokRun, TikTokClientAbortError, TIKTOK_CLIENT_TIMEOUT_MS } from './src/lib/tiktok-safeguards';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = new URL('.', import.meta.url).pathname;
const PHASE_FILES = [
  'tiktok-phase1-test.ts',
  'tiktok-phase2-test.ts',
  'tiktok-phase3-test.ts',
  'tiktok-phase4-test.ts',
  'tiktok-phase6-directions-test.ts',
];

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

// ── [1–4] Phasen-Sätze als Subprozesse ───────────────────────────────────────
async function runPhaseFile(file: string): Promise<{ ok: boolean; pass: number; fail: number; ms: number }> {
  const t0 = Date.now();
  const proc = Bun.spawn(['bun', 'run', resolve(REPO, file)], {
    cwd: REPO,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitRaw = await proc.exited;
  const exitCode = typeof exitRaw === 'number' ? exitRaw : ((exitRaw as { code?: number }).code ?? 1);
  const all = out + '\n' + err;
  const m1 = all.match(/PASS:\s*(\d+)\s+FAIL:\s*(\d+)/);
  const m2 = all.match(/Phase\s+\d+:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
  const pass = m1 ? Number(m1[1]) : m2 ? Number(m2[1]) : 0;
  const fail = m1 ? Number(m1[2]) : m2 ? Number(m2[2]) : 0;
  const ok = exitCode === 0 && fail === 0;
  console.log(
    `[suite] ${file}: exit=${exitCode} PASS: ${pass} FAIL: ${fail} (${Date.now() - t0} ms) ${ok ? '✓' : '✗'}`,
  );
  if (!ok && !m1 && !m2) {
    console.log(err.slice(0, 1200));
  }
  if (!ok) failures.push(`${file} (exit ${exitCode}, FAIL ${fail})`);
  passed += pass;
  failed += fail;
  return { ok, pass, fail, ms: Date.now() - t0 };
}

// ── OpenAI-Mock (in-process, ohne echtes Netz) ───────────────────────────────
type Responder = (attempt: number, userPrompt: string) => string | Promise<string>;
let responder: Responder | null = null;
let callCount = 0;
let hangMode = false;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await req.json()) as { messages?: Array<{ role?: string; content?: unknown }> };
    callCount += 1;
    if (hangMode) {
      // Verbindung offen halten, nie antworten — Client/Server-Abort muss den
      // OpenAI-SDK-Call abbrechen (H5).
      return new Promise<Response>(() => {});
    }
    const userMsg = (body?.messages?.find((m) => m.role === 'user')?.content as string | undefined) ?? '';
    const content = responder ? await responder(callCount, userMsg) : '{}';
    return Response.json({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  },
});
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
process.env.OPENAI_API_KEY = 'sk-mock';

/** Gültiger todayIdea-Payload (alle SelfCheck-Flags sauber). */
const CLEAN_SELFCHECK = {
  usesConcreteBrandFact: true,
  addressesCurrentChallenge: false,
  interchangeable: false,
  soundsLikeAd: false,
  inventsUserOrTestimonial: false,
  unprovenPerformancePromise: false,
  prescribedEnthusiasm: false,
};
function cleanIdeaPayload(): string {
  return JSON.stringify({
    idea: 'Zeig den Herstellungsprozess der handgemachten Keramikbecher',
    hook: 'So entsteht dein Lieblingsbecher in einem Tag',
    length: '30 Sekunden',
    scenes: ['Rohling auf der Drehscheibe', 'Tasse formen und glasieren', 'Fertiges Produkt zeigen'],
    overlays: ['So entsteht dein Lieblingsbecher'],
    spokenText: 'Heute zeige ich dir, wie aus einem Klumpen Ton dein Lieblingsbecher wird.',
    caption: 'Handarbeit vom Rohling bis zum fertigen Becher mit Duftkerze',
    hashtags: ['#keramik', '#handmade', '#becher', '#werkstatt'],
    cta: 'Was möchtest du als Nächstes sehen?',
    why: 'Zuschauer lieben echte Einblicke hinter die Kulissen.',
    selfCheck: CLEAN_SELFCHECK,
  });
}

/** Hängt bis zum Abort (respektiert das Signal) — bildet einen Client-Call ab,
 *  dessen Server nie antwortet. */
function hangingRun(signal: AbortSignal): Promise<string> {
  return new Promise<string>((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

// ── [5] Härtungstests ────────────────────────────────────────────────────────
async function hardeningTests() {
  console.log('\n── Härtungstests (Phase 5) ──');

  // H1 Client-Abbruch (Abbrechen-Button): Mock hängt → abort() beendet sofort.
  {
    const t0 = Date.now();
    const guarded = guardTikTokRun(hangingRun, 5_000);
    const abortTimer = setTimeout(() => guarded.abort('user'), 80);
    const err = await guarded.promise.then(() => null, (e) => e);
    clearTimeout(abortTimer);
    const elapsed = Date.now() - t0;
    check(err instanceof TikTokClientAbortError && err.reason === 'user', 'H1 Client-Abbruch → TikTokClientAbortError(user)');
    check(elapsed < 2_000, `H1b kein Hänger nach Abbruch (${elapsed} ms < 2000)`);
    check(guarded.reason() === 'user', 'H1c Grund für UI-Meldung = user');
  }

  // H2 Client-Timeout (Default 90 s; Test verkürzt auf 120 ms).
  {
    const t0 = Date.now();
    const err = await guardTikTokRun(hangingRun, 120).promise.then(() => null, (e) => e);
    const elapsed = Date.now() - t0;
    check(err instanceof TikTokClientAbortError && err.reason === 'timeout', 'H2 Client-Timeout → TikTokClientAbortError(timeout)');
    check(elapsed < 2_000, `H2b Timeout bricht ab (${elapsed} ms < 2000)`);
  }

  // H3 Retry-Budget: Mock liefert immer unlesbares JSON → nach max. 4 Versuchen
  // ehrlicher Fehler (kein Endlos-Retry, kein Hänger).
  {
    responder = () => '{}'; // unlesbar → parseResult null → Retry
    callCount = 0;
    const t0 = Date.now();
    const err = await generateTikTok({ mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', goal: 'Verkäufe' }, 'de').then(
      () => null,
      (e) => e,
    );
    check(callCount === 4, `H3a Retry-Budget: genau 4 Versuche (tatsächlich ${callCount})`);
    check(err instanceof Error && String(err.message).includes('konnte nicht gelesen werden'), 'H3b ehrlicher Fehler nach max. 4 Versuchen (de)');
    check(Date.now() - t0 < 5_000, 'H3c kein Hänger nach Retry-Budget');
  }

  // H4 Server-Timeout VOR dem ersten LLM-Call (Signal bereits abgebrochen).
  {
    callCount = 0;
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await generateTikTok({ mode: 'todayIdea', biz: 'X' }, 'de', ctrl.signal).then(() => null, (e) => e);
    check(err instanceof Error && String(err.message) === 'Die Anfrage hat zu lange gedauert. Bitte erneut versuchen.', 'H4a vorab abgebrochen → saubere Timeout-Meldung (de)');
    check(callCount === 0, 'H4b kein LLM-Call bei vorab abgebrochenem Signal');
  }

  // H5 Server-Timeout WÄHREND des LLM-Calls (Mock hängt) → AbortSignal bricht ab.
  {
    hangMode = true;
    callCount = 0;
    const ctrl = new AbortController();
    const t0 = Date.now();
    const p = generateTikTok({ mode: 'todayIdea', biz: 'Handgemachte Keramikbecher' }, 'de', ctrl.signal).then(
      () => null,
      (e) => e,
    );
    const abortTimer = setTimeout(() => ctrl.abort(), 150);
    const err = await p;
    clearTimeout(abortTimer);
    hangMode = false;
    check(callCount === 1, 'H5a Call gestartet (1 Mock-Request)');
    check(err instanceof Error && String(err.message).includes('zu lange gedauert'), 'H5b laufender Call abgebrochen → saubere Timeout-Meldung');
    check(Date.now() - t0 < 5_000, `H5c kein Hänger (${Date.now() - t0} ms)`);
  }

  // H6 Happy Path mit Signal — Signal-Param verschlechtert den Normalbetrieb nicht.
  {
    responder = () => cleanIdeaPayload();
    const ctrl = new AbortController();
    const res = await generateTikTok({ mode: 'todayIdea', biz: 'Handgemachte Keramikbecher', goal: 'Verkäufe' }, 'de', ctrl.signal);
    check(!!res && (res as { idea?: string }).idea === 'Zeig den Herstellungsprozess der handgemachten Keramikbecher', 'H6 Happy Path mit Signal → Ergebnis wie ohne Signal');
  }

  // H7 i18n-Parität de/en für ALLE tiktok_*-Keys (inkl. Phase-4/5-Keys).
  {
    const deSrc = readFileSync(resolve(REPO, 'src/i18n/de.ts'), 'utf8');
    const enSrc = readFileSync(resolve(REPO, 'src/i18n/en.ts'), 'utf8');
    const tiktokKeys = (s: string): string[] =>
      [...s.matchAll(/^\s{2}(tiktok_[a-z0-9_]+):/gm)].map((m) => m[1]).sort();
    const deK = tiktokKeys(deSrc);
    const enK = tiktokKeys(enSrc);
    check(deK.length === enK.length, `H7a tiktok_-Keys: de (${deK.length}) == en (${enK.length})`);
    check(deK.join('|') === enK.join('|'), 'H7b keine fehlende/überzählige tiktok_-Übersetzung (Set-Gleichheit)');
    check(deK.length >= 92, `H7c mind. 92 tiktok_-Keys je Datei (Phase 4+5 inklusive; jetzt ${deK.length})`);
    for (const k of ['tiktok_abort', 'tiktok_loading_hint', 'tiktok_error_timeout', 'tiktok_error_aborted']) {
      check(deK.includes(k) && enK.includes(k), `H7d Phase-5-Key ${k} in de + en`);
    }
  }

  // H8 Server-Handler + Engine-Timeout verdrahtet.
  {
    const serverSrc = readFileSync(resolve(REPO, 'src/ai/server.ts'), 'utf8');
    const tiktokSrc = readFileSync(resolve(REPO, 'src/ai/tiktok.ts'), 'utf8');
    check(serverSrc.includes('TIKTOK_TIMEOUT_MS') && serverSrc.includes('AbortController') && serverSrc.includes('ctrl.signal'), 'H8a server.ts: Timeout-Handler (AbortController + TIKTOK_TIMEOUT_MS) verdrahtet');
    check(tiktokSrc.includes('export const TIKTOK_TIMEOUT_MS = 75_000'), 'H8b tiktok.ts: Server-Timeout 75 s (unter maxDuration 300 s)');
    check(tiktokSrc.includes('signal?: AbortSignal') && tiktokSrc.includes('signal?.aborted'), 'H8c tiktok.ts: Signal-Param + Abbruch-Checks in der Retry-Schleife');
  }

  // H9 Client-Wiring (Route): Guard, Abort-Button, Timeout-Meldungen.
  {
    const routeSrc = readFileSync(resolve(REPO, 'src/routes/app/tiktok.tsx'), 'utf8');
    check(routeSrc.includes('guardTikTokRun') && routeSrc.includes('signal'), 'H9a tiktok.tsx: Guard + AbortSignal am createServerFn-Aufruf');
    check(routeSrc.includes('handleAbortTikTok') && routeSrc.includes('tiktok_abort'), 'H9b tiktok.tsx: Abbrechen-Button');
    check(routeSrc.includes('tiktok_error_timeout') && routeSrc.includes('tiktok_error_aborted'), 'H9c tiktok.tsx: ehrliche Fehlermeldungen (Timeout/Abbruch)');
  }

  // H10 Client-Timeout-Konfiguration.
  {
    const guardSrc = readFileSync(resolve(REPO, 'src/lib/tiktok-safeguards.ts'), 'utf8');
    check(guardSrc.includes('TIKTOK_CLIENT_TIMEOUT_MS = 90_000'), 'H10 Client-Timeout 90 s konfiguriert');
    check(TIKTOK_CLIENT_TIMEOUT_MS === 90_000, 'H10b exportierter Wert = 90_000');
  }
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
async function main() {
  console.log('===== TikTok Test Suite (Phase 1–5) =====');
  for (const [i, f] of PHASE_FILES.entries()) {
    console.log(`\n[${i + 1}/5] Phase-Suite: ${f}`);
    await runPhaseFile(f);
  }
  await hardeningTests();
  // [6] Transport-Regressions-Test (Produktions-Regression 2026-09): echtes
  // ServerFn-Transport mit signal im Payload vs. ohne + Round-Trip durch den
  // gebauten SSR-Server (dist) + Git-Regression der gemeinsamen AI-/Stream-
  // Infrastruktur. Läuft offline (ohne .env) UND mit .env grün.
  console.log('\n[6/6] Transport-Regressions-Test: transport-regression-test.ts');
  await runPhaseFile('transport-regression-test.ts');
  server.stop(true);
  console.log('\n===== GESAMT =====');
  console.log(`Summe PASS: ${passed}  FAIL: ${failed}`);
  if (failures.length) {
    console.log('Fehlgeschlagen:', failures.join(' | '));
    console.log(`EXIT: 1 (${failures.length} problematische Sätze/Tests)`);
    process.exit(1);
  }
  console.log('ALLE TEST-SÄTZE GRÜN (Phase 1–4 Regression + Phase 5 Härtung + i18n)');
  process.exit(0);
}

void main();
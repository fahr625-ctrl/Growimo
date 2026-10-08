// ── Option 1 (Bild-Latenz, Owner-Freigabe 2026-10-07): Streaming-Suite ───────
// Prüft die NEUEN Teile ohne jeden echten OpenAI-/Netzwerk-Aufruf:
//   A) SSE-Route/Event-Pfad (src/api/image-stream.ts) — Reihenfolge-Garantie
//      partial* → done, Fehler als `error`, kein Zombie-Stream.
//   B) Client-Pfad (src/lib/image-studio-stream.ts) — inkrementelles Flushen,
//      Partial-Verarbeitung, ehrlicher Rückfall auf den ServerFn.
//   C) generateImageStreaming mit GEMOCKTEM openai-Modul (kein API-Call):
//      Zwischenbilder kommen durch, Endbild = letztes Event, fail-closed-Fallback
//      NUR ohne vorheriges Zwischenbild (kein zweiter Modell-Call).
//      Launch-Fix 2026-10-08: im Edit-/Variations-Pfad darf für gpt-image-2 KEIN
//      `input_fidelity` im Request stehen (die API lehnt ihn mit 400 ab); bei
//      gpt-image-1 wird er weiterhin gesendet (C11–C17).
//   D) Timeout 240 s, i18n-Parität de/en, Client-Verdrahtung, unveränderte
//      Qualitäts-/Formatparameter (gpt-image-2, quality high, exakte Sizes).
import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`PASS: ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ROOT = '/home/team/shared/site';
const read = (rel: string) => readFileSync(`${ROOT}/${rel}`, 'utf8');

const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fake-SSE-Antwort aus Chunks (mit steuerbaren Verzögerungen = Flush-Beweis). */
function sseResponse(
  chunks: Array<{ text: string; delayMs?: number }>,
  init: { status?: number; contentType?: string } = {},
): Response {
  const body = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (chunk.delayMs) await sleep(chunk.delayMs);
        controller.enqueue(encoder.encode(chunk.text));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'text/event-stream; charset=utf-8' },
  });
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const PNG_A = 'data:image/png;base64,AAAA';
const PNG_B = 'data:image/png;base64,BBBB';
const PNG_FINAL = 'data:image/png;base64,FFFFFFFF';

// ── A) Event-Pfad der Route ───────────────────────────────────────────────────
const { emitImageStreamEvents, parseImageStreamBody, handleImageStreamApi, IMAGE_STREAM_PATH } =
  await import('./src/api/image-stream');

{
  const sent: Array<Record<string, unknown>> = [];
  const outcome = await emitImageStreamEvents({
    body: { prompt: 'p', aspectRatio: '2:3' },
    send: (e) => sent.push(e as unknown as Record<string, unknown>),
    generate: async (onPartial) => {
      onPartial({ index: 0, dataUrl: PNG_A });
      onPartial({ index: 1, dataUrl: PNG_B });
      return { url: PNG_FINAL, mode: 'generate', partials: 2, usedFallback: false };
    },
  });
  check('A1 letztes Event = done', sent.at(-1)?.type === 'done');
  check('A2 erstes Event = partial', sent[0]?.type === 'partial');
  check('A3 genau 2 partials vor done', sent.filter((e) => e.type === 'partial').length === 2);
  check('A4 Reihenfolge partial(0),partial(1),done', sent.map((e) => e.type).join(',') === 'partial,partial,done');
  check('A5 partial trägt index+dataUrl', sent[0]?.index === 0 && sent[0]?.dataUrl === PNG_A);
  check('A6 done trägt url/partials/usedFallback/mode',
    sent.at(-1)?.url === PNG_FINAL && sent.at(-1)?.partials === 2 && sent.at(-1)?.usedFallback === false && sent.at(-1)?.mode === 'generate');
  check('A7 Outcome durchgereicht', outcome.url === PNG_FINAL && outcome.partials === 2);
}

{
  const sent: Array<Record<string, unknown>> = [];
  const outcome = await emitImageStreamEvents({
    body: { prompt: 'p', aspectRatio: '1:1' },
    send: (e) => sent.push(e as unknown as Record<string, unknown>),
    generate: async () => ({ url: PNG_FINAL, mode: 'edit', partials: 0, usedFallback: true }),
  });
  check('A8 fail-closed-Fallback wird ehrlich gemeldet (kein partial)',
    sent.length === 1 && sent[0]?.type === 'done' && sent[0]?.usedFallback === true && outcome.usedFallback === true);
}

{
  // Fehler VOR dem ersten Zwischenbild → genau EIN error-Event, kein done.
  const sent: Array<Record<string, unknown>> = [];
  let threw = false;
  try {
    await emitImageStreamEvents({
      body: { prompt: 'p', aspectRatio: '1:1' },
      send: (e) => sent.push(e as unknown as Record<string, unknown>),
      generate: async () => {
        throw new Error('kaputt');
      },
    });
  } catch {
    threw = true;
  }
  check('A9 Fehler wird geworfen (Route sendet daraus error-Event)', threw && sent.length === 0);
}

{
  const parsed = parseImageStreamBody({ prompt: '  hallo  ', aspectRatio: '9:16' });
  check('A10 Body-Validierung: prompt getrimmt, 9:16 durchgelassen',
    !('error' in parsed) && parsed.prompt === 'hallo' && parsed.aspectRatio === '9:16');
  const bad = parseImageStreamBody({ prompt: '', aspectRatio: '2:3' });
  check('A11 leerer prompt → Fehler', 'error' in bad);
  const unknownRatio = parseImageStreamBody({ prompt: 'x', aspectRatio: '7:5' });
  check('A12 unbekanntes Format → fail-safe 1:1',
    !('error' in unknownRatio) && unknownRatio.aspectRatio === '1:1');
  const badRef = parseImageStreamBody({ prompt: 'x', aspectRatio: '1:1', referenceImageData: 'nicht-base64' });
  check('A13 ungültige Referenz → undefined (fail-closed)',
    !('error' in badRef) && badRef.referenceImageData === undefined);
}

{
  // HTTP-Randfälle ohne Netzwerk: falscher Pfad, falsche Methode, ohne Sitzung.
  const other = await handleImageStreamApi(new Request('https://x/y', { method: 'POST' }), '/api/other');
  check('A14 fremder Pfad → null (Kette läuft weiter)', other === null);
  const get = await handleImageStreamApi(new Request(`https://x${IMAGE_STREAM_PATH}`, { method: 'GET' }), IMAGE_STREAM_PATH);
  check('A15 GET → 405', get?.status === 405);
  const noSession = await handleImageStreamApi(
    new Request(`https://x${IMAGE_STREAM_PATH}`, { method: 'POST', body: JSON.stringify({ prompt: 'p' }) }),
    IMAGE_STREAM_PATH,
  );
  check('A16 ohne __session-Cookie → 401 (Auth vor Body-Parse)', noSession?.status === 401);
  check('A17 Pfad-Konstante = /api/image/stream', IMAGE_STREAM_PATH === '/api/image/stream');
}

// ── B) Client-Pfad ────────────────────────────────────────────────────────────
const {
  runImageStream,
  runStudioImage,
  parseSseBlock,
  ImageStreamUnavailableError,
  ImageStreamServerError,
} = await import('./src/lib/image-studio-stream');

{
  const partials: string[] = [];
  const t0 = Date.now();
  const stampPartial: number[] = [];
  const result = await runImageStream({
    body: { prompt: 'p', aspectRatio: '2:3' },
    fetchImpl: (async () => sseResponse([
      { text: ': heartbeat\n\n' },
      { text: sse({ type: 'partial', index: 0, dataUrl: PNG_A }), delayMs: 30 },
      { text: sse({ type: 'partial', index: 1, dataUrl: PNG_B }), delayMs: 40 },
      { text: sse({ type: 'done', url: PNG_FINAL, mode: 'generate', partials: 2, usedFallback: false }), delayMs: 10 },
    ])) as unknown as typeof fetch,
    onPartial: (p) => {
      partials.push(p.dataUrl);
      stampPartial.push(Date.now() - t0);
    },
  });
  check('B1 beide Zwischenbilder kamen an (Reihenfolge)', partials.join('|') === `${PNG_A}|${PNG_B}`);
  check('B2 Endbild = done-Event', result.url === PNG_FINAL && result.partials === 2 && result.usedFallback === false);
  check('B3 Partials INKREMENTELL (deutlich vor dem Ende der Antwort)',
    stampPartial.length === 2 && stampPartial[1] < Date.now() - t0 - 5,
    `stamps=${stampPartial.join(',')} total=${Date.now() - t0}`);
  check('B4 Heartbeat-Kommentar erzeugt kein Event', partials.length === 2);
}

{
  // Event über Chunk-Grenzen hinweg zerlegt (echtes Netzverhalten).
  const partials: string[] = [];
  const half = sse({ type: 'partial', index: 0, dataUrl: PNG_A });
  const result = await runImageStream({
    body: { prompt: 'p', aspectRatio: '1:1' },
    fetchImpl: (async () => sseResponse([
      { text: half.slice(0, 12) },
      { text: half.slice(12) + sse({ type: 'done', url: PNG_FINAL, mode: 'generate', partials: 1, usedFallback: false }) },
    ])) as unknown as typeof fetch,
    onPartial: (p) => partials.push(p.dataUrl),
  });
  check('B5 über Chunk-Grenzen zerlegtes Event wird korrekt gelesen',
    partials.length === 1 && partials[0] === PNG_A && result.url === PNG_FINAL);
}

{
  // Server-Fehler-Event → echter Fehler (kein stiller Erfolg, kein Hänger).
  let err: unknown = null;
  try {
    await runImageStream({
      body: { prompt: 'p', aspectRatio: '1:1' },
      fetchImpl: (async () => sseResponse([{ text: sse({ type: 'error', message: 'Limit erreicht' }) }])) as unknown as typeof fetch,
      onPartial: () => {},
    });
  } catch (e) {
    err = e;
  }
  check('B6 error-Event → ImageStreamServerError mit Meldung',
    err instanceof ImageStreamServerError && (err as Error).message === 'Limit erreicht');
}

{
  // Abgerissene Verbindung ohne done.
  let err: unknown = null;
  try {
    await runImageStream({
      body: { prompt: 'p', aspectRatio: '1:1' },
      fetchImpl: (async () => sseResponse([{ text: sse({ type: 'partial', index: 0, dataUrl: PNG_A }) }])) as unknown as typeof fetch,
      onPartial: () => {},
    });
  } catch (e) {
    err = e;
  }
  check('B7 Stream ohne done → Fehler (kein Zombie-Versprechen)',
    err instanceof ImageStreamServerError);
}

{
  // Nicht erreichbare Route (HTML-Seite / 404) → Unavailable (Rückfall erlaubt).
  let err: unknown = null;
  try {
    await runImageStream({
      body: { prompt: 'p', aspectRatio: '1:1' },
      fetchImpl: (async () => sseResponse([{ text: '<html>Not found</html>' }], { status: 404, contentType: 'text/html' })) as unknown as typeof fetch,
      onPartial: () => {},
    });
  } catch (e) {
    err = e;
  }
  check('B8 HTML/404 → ImageStreamUnavailableError', err instanceof ImageStreamUnavailableError);

  // 200 mit HTML (SSR-Fallback mancher Umgebungen) ebenfalls nicht nutzbar.
  let err2: unknown = null;
  try {
    await runImageStream({
      body: { prompt: 'p', aspectRatio: '1:1' },
      fetchImpl: (async () => sseResponse([{ text: '<html></html>' }], { contentType: 'text/html' })) as unknown as typeof fetch,
      onPartial: () => {},
    });
  } catch (e) {
    err2 = e;
  }
  check('B9 200+text/html → Unavailable (kein Versehen-Parsen)', err2 instanceof ImageStreamUnavailableError);
}

check('B10 Parser ignoriert Unbekanntes/Leeres',
  parseSseBlock(': heartbeat') === null && parseSseBlock('data: kein json') === null && parseSseBlock('data: {"type":"neu"}') === null);
check('B11 Parser verwirft partial ohne echtes Bild',
  parseSseBlock(`data: ${JSON.stringify({ type: 'partial', index: 0, dataUrl: 'javascript:alert(1)' })}`) === null);

{
  // runStudioImage: Streaming-Erfolg → Partials weitergereicht, kein Rückfall.
  let fallbackCalls = 0;
  const seen: string[] = [];
  const result = await runStudioImage({
    body: { prompt: 'p', aspectRatio: '2:3' },
    signal: new AbortController().signal,
    fallback: async () => {
      fallbackCalls += 1;
      return { url: 'data:image/png;base64,FALLBACK' };
    },
    onPartial: (p) => seen.push(p.dataUrl),
    runStream: async (a) => {
      a.onPartial({ index: 0, dataUrl: PNG_A });
      a.onPartial({ index: 1, dataUrl: PNG_B });
      return { type: 'done', url: PNG_FINAL, mode: 'generate', partials: 2, usedFallback: false };
    },
  });
  check('B12 Erfolg: streamed=true, kein Rückfall',
    result.streamed === true && result.usedFallback === false && fallbackCalls === 0 && result.url === PNG_FINAL);
  check('B13 OnPartial-Vermittlung an die UI (jedes Partial)', seen.join('|') === `${PNG_A}|${PNG_B}`);
}

{
  // Route fehlt (z. B. Umgebung ohne sie) und KEIN Partial → ServerFn-Rückfall.
  let fallbackCalls = 0;
  const result = await runStudioImage({
    body: { prompt: 'p', aspectRatio: '2:3' },
    signal: new AbortController().signal,
    fallback: async () => {
      fallbackCalls += 1;
      return { url: 'data:image/png;base64,FALLBACK' };
    },
    onPartial: () => {},
    runStream: async () => {
      throw new ImageStreamUnavailableError('HTTP 404', 404);
    },
  });
  check('B14 Unavailable ohne Partial → genau EIN ServerFn-Rückfall',
    fallbackCalls === 1 && result.url.endsWith('FALLBACK') && result.usedFallback === true && result.streamed === false);
}

{
  // Nach einem Zwischenbild darf es KEINEN zweiten (bezahlten) Lauf geben.
  let fallbackCalls = 0;
  let err: unknown = null;
  try {
    await runStudioImage({
      body: { prompt: 'p', aspectRatio: '2:3' },
      signal: new AbortController().signal,
      fallback: async () => {
        fallbackCalls += 1;
        return { url: 'data:image/png;base64,FALLBACK' };
      },
      onPartial: () => {},
      runStream: async (a) => {
        a.onPartial({ index: 0, dataUrl: PNG_A });
        throw new ImageStreamUnavailableError('Abbruch', 0);
      },
    });
  } catch (e) {
    err = e;
  }
  check('B15 Partial angekommen → KEIN zweiter Modell-Call, Fehler wird gemeldet',
    fallbackCalls === 0 && err instanceof ImageStreamUnavailableError);
}

{
  // Server-Fehler-Event führt NICHT zu einem stillen ServerFn-Rückfall.
  let fallbackCalls = 0;
  let err: unknown = null;
  try {
    await runStudioImage({
      body: { prompt: 'p', aspectRatio: '2:3' },
      signal: new AbortController().signal,
      fallback: async () => {
        fallbackCalls += 1;
        return { url: 'x' };
      },
      onPartial: () => {},
      runStream: async () => {
        throw new ImageStreamServerError('Dein monatliches Limit ist aufgebraucht');
      },
    });
  } catch (e) {
    err = e;
  }
  check('B16 Server-Fehler (z. B. Limit) → kein Rückfall, Meldung bleibt sichtbar',
    fallbackCalls === 0 && err instanceof ImageStreamServerError);
}

{
  // Echter fetch-Pfad von runStudioImage (Ende-zu-Ende ohne Netzwerk): Partials
  // aus dem SSE-Stream landen in der UI, Endbild kommt an.
  const seen: string[] = [];
  const result = await runStudioImage({
    body: { prompt: 'p', aspectRatio: '2:3' },
    signal: new AbortController().signal,
    fallback: async () => ({ url: 'data:image/png;base64,FALLBACK' }),
    onPartial: (p) => seen.push(p.dataUrl),
    fetchImpl: (async () => sseResponse([
      { text: sse({ type: 'partial', index: 0, dataUrl: PNG_A }), delayMs: 5 },
      { text: sse({ type: 'done', url: PNG_FINAL, mode: 'generate', partials: 1, usedFallback: false }), delayMs: 5 },
    ])) as unknown as typeof fetch,
  });
  check('B17 Ende-zu-Ende (Route-Event → UI-Partial → Endbild)',
    seen.length === 1 && seen[0] === PNG_A && result.url === PNG_FINAL && result.streamed === true);
}

// ── C) generateImageStreaming mit gemocktem openai-Modul ─────────────────────
const calls: Array<{ path: 'generate' | 'edit'; params: Record<string, unknown> }> = [];
let streamScript: (params: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> = () => (async function* () {})();
let nonStreamUrl = 'data:image/png;base64,NONSTREAM';

mock.module('openai', () => {
  class FakeOpenAI {
    images = {
      generate: async (params: Record<string, unknown>) => {
        calls.push({ path: 'generate', params });
        if (params.stream) return streamScript(params);
        return { data: [{ b64_json: nonStreamUrl.replace('data:image/png;base64,', '') }] };
      },
      edit: async (params: Record<string, unknown>) => {
        calls.push({ path: 'edit', params });
        if (params.stream) return streamScript(params);
        return { data: [{ b64_json: 'EDIT' }] };
      },
    };
  }
  return { default: FakeOpenAI, toFile: async (bytes: Uint8Array, name: string, opts: unknown) => ({ bytes, name, opts }) };
});

process.env.OPENAI_API_KEY = 'test-key';
delete process.env.IMAGE_QUALITY;
const {
  generateImageStreaming,
  generateImage,
  IMAGE_PARTIAL_COUNT,
  modelSupportsInputFidelity,
  editFidelityOptions,
} = await import('./src/ai/image-providers/generate');

{
  // Happy path: 2 Zwischenbilder, dann das Endbild.
  calls.length = 0;
  streamScript = () => (async function* () {
    yield { type: 'image_generation.partial_image', b64_json: 'AAA', partial_image_index: 0 };
    yield { type: 'image_generation.partial_image', b64_json: 'BBB', partial_image_index: 1 };
    yield { type: 'image_generation.completed', b64_json: 'FFFF', output_format: 'png' };
  })();
  const partials: Array<{ index: number; dataUrl: string }> = [];
  const outcome = await generateImageStreaming('prompt', '2:3', undefined, (p) => partials.push(p));
  check('C1 Endbild = completed-Event', outcome.url === 'data:image/png;base64,FFFF');
  check('C2 partials gezählt (2), usedFallback=false',
    outcome.partials === 2 && outcome.usedFallback === false && outcome.mode === 'generate');
  check('C3 Zwischenbilder in Reihenfolge/index an den Client',
    partials.length === 2 && partials[0]?.dataUrl === 'data:image/png;base64,AAA' && partials[1]?.index === 1);
  const streamCall = calls.find((c) => c.path === 'generate');
  check('C4 Modell/Qualität/Größe UNVERÄNDERT (gpt-image-2, high, 1024x1536)',
    streamCall?.params.model === 'gpt-image-2' && streamCall?.params.quality === 'high' && streamCall?.params.size === '1024x1536');
  check('C5 stream:true + partial_images=IMAGE_PARTIAL_COUNT',
    streamCall?.params.stream === true && streamCall?.params.partial_images === IMAGE_PARTIAL_COUNT && IMAGE_PARTIAL_COUNT === 2);
  check('C6 kein zweiter Modell-Call bei Erfolg', calls.length === 1);
}

{
  // Stream-Fehler OHNE Zwischenbild → fail-closed auf den klassischen Pfad.
  calls.length = 0;
  streamScript = () => (async function* () {
    throw new Error('streaming nicht unterstützt');
  })();
  const outcome = await generateImageStreaming('prompt', '1:1', undefined, () => {
    throw new Error('darf nicht aufgerufen werden');
  });
  check('C7 Fallback ohne Partial: usedFallback=true, partials=0',
    outcome.usedFallback === true && outcome.partials === 0 && outcome.url === nonStreamUrl);
  check('C8 genau ZWEI Calls (stream-Versuch + klassisch), Klasse korrekt',
    calls.length === 2 && calls[0]?.path === 'generate' && calls[1]?.path === 'generate' && calls[1]?.params.stream === undefined);
  check('C9 Fallback nutzt gleiche Qualität/Größe',
    calls[1]?.params.quality === 'high' && calls[1]?.params.size === '1024x1024');
}

{
  // Stream bricht NACH einem Zwischenbild ab → Fehler, KEIN zweiter Call.
  calls.length = 0;
  streamScript = () => (async function* () {
    yield { type: 'image_generation.partial_image', b64_json: 'AAA', partial_image_index: 0 };
    throw new Error('Verbindung weg');
  })();
  let err: unknown = null;
  try {
    await generateImageStreaming('prompt', '1:1', undefined, () => {});
  } catch (e) {
    err = e;
  }
  check('C10 Abbruch nach Partial → Fehler, kein doppelter bezahlter Call',
    err instanceof Error && calls.length === 1);
}

{
  // Edit-Pfad (Referenzbild) streamt genauso — Größe/Qualität/Parameter identisch.
  calls.length = 0;
  streamScript = () => (async function* () {
    yield { type: 'image_edit.partial_image', b64_json: 'AAA', partial_image_index: 0 };
    yield { type: 'image_edit.completed', b64_json: 'ZZZ', output_format: 'png' };
  })();
  // 1x1 PNG-data-URL (gültige base64-Struktur, Inhalt wird nicht dekodiert).
  const ref = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const outcome = await generateImageStreaming('prompt', '4:3', ref, () => {});
  const editCall = calls.find((c) => c.path === 'edit');
  check('C11 Edit-Variante streamt (1152x864, high, model/quality/size unverändert)',
    outcome.mode === 'edit' && outcome.url === 'data:image/png;base64,ZZZ' && outcome.partials === 1 &&
    editCall?.params.model === 'gpt-image-2' && editCall?.params.size === '1152x864' && editCall?.params.quality === 'high');
  // Launch-Fix 2026-10-08: gpt-image-2 lehnt `input_fidelity` mit 400 ab — der
  // Schlüssel darf im Streaming-Edit-Request GAR NICHT vorkommen (nicht nur null).
  check('C12 gpt-image-2: KEIN input_fidelity im Streaming-Edit-Request (400-Fix)',
    editCall !== undefined && !('input_fidelity' in editCall.params),
    `keys=${editCall ? Object.keys(editCall.params).join(',') : 'kein edit-Call'}`);
}

{
  // Nicht-streamender Edit-Pfad (Rückfall auf generateImage mit Referenz) —
  // derselbe Fix: kein input_fidelity, sonst wäre der fail-closed-Rückfall selbst 400.
  calls.length = 0;
  streamScript = () => (async function* () {})();
  const ref = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const out = await generateImage('prompt', '4:3', ref);
  const editCall = calls.find((c) => c.path === 'edit');
  check('C13 Nicht-streamender Edit-Pfad: kein input_fidelity, Größe/Qualität unverändert',
    out.url === 'data:image/png;base64,EDIT' && editCall !== undefined &&
    !('input_fidelity' in editCall.params) &&
    editCall.params.size === '1152x864' && editCall.params.quality === 'high' &&
    editCall.params.model === 'gpt-image-2');
  check('C14 generierte (Text→Bild) Requests bleiben ohne input_fidelity',
    calls.filter((c) => c.path === 'generate').every((c) => !('input_fidelity' in c.params)));
}

{
  // Modellabhängigkeit selbst (ohne API-Call): nur die gpt-image-1-Familie kennt
  // den Parameter. gpt-image-2 → Option entfällt; default = aktives MODEL.
  check('C15 modelSupportsInputFidelity: gpt-image-2 false, gpt-image-1(.x) true',
    modelSupportsInputFidelity('gpt-image-2') === false &&
    modelSupportsInputFidelity('gpt-image-1') === true &&
    modelSupportsInputFidelity('gpt-image-1.5') === true &&
    modelSupportsInputFidelity('unbekannt') === false);
  check('C16 editFidelityOptions: gpt-image-1 → high, gpt-image-2 → leer',
    editFidelityOptions('gpt-image-1').input_fidelity === 'high' &&
    Object.keys(editFidelityOptions('gpt-image-2')).length === 0);
  check('C17 Default (aktives MODEL=gpt-image-2) → keine input_fidelity-Option',
    Object.keys(editFidelityOptions()).length === 0);
}

// ── D) Timeout, i18n, Verdrahtung, unveränderte Parameter ────────────────────
const safeguards = await import('./src/lib/image-safeguards');
check('D1 IMAGE_CLIENT_TIMEOUT_MS = 240_000', safeguards.IMAGE_CLIENT_TIMEOUT_MS === 240_000);
check('D2 Timeout deckt die gemessene 83,5-s-Varianz mit Reserve',
  safeguards.IMAGE_CLIENT_TIMEOUT_MS >= 200_000);

const de = await import('./src/i18n/de');
const en = await import('./src/i18n/en');
const deKeys = Object.keys(de.de);
const enKeys = Object.keys(en.en);
check('D3 i18n-Parität: gleiche Anzahl Keys (de=en)', deKeys.length === enKeys.length,
  `de=${deKeys.length} en=${enKeys.length}`);
const missingInEn = deKeys.filter((k) => !enKeys.includes(k));
const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
check('D4 keine unübersetzten Keys', missingInEn.length === 0 && missingInDe.length === 0,
  `missingEn=${missingInEn.join(',')} missingDe=${missingInDe.join(',')}`);
const t: Record<string, unknown> = de.de as unknown as Record<string, unknown>;
const te: Record<string, unknown> = en.en as unknown as Record<string, unknown>;
check('D5 Streaming-Hinweis de/en vorhanden',
  typeof t.image_studio_streaming_refining === 'string' && String(t.image_studio_streaming_refining).includes('Echtzeit') &&
  typeof te.image_studio_streaming_refining === 'string' && String(te.image_studio_streaming_refining).includes('real time'));
check('D6 Live-Vorschau-Badge de/en vorhanden',
  t.image_studio_streaming_preview_badge === 'Live-Vorschau' && te.image_studio_streaming_preview_badge === 'Live preview');

const studio = read('src/routes/app/image-studio.tsx');
check('D7 Client rendert das Zwischenbild in der Vorschau',
  studio.includes('data-testid="image-studio-stream-preview"') && studio.includes('src={streamPreview}'));
check('D8 Client-Handler verarbeitet das partial-Event',
  studio.includes('onPartial: (partial) => setStreamPreview(partial.dataUrl)') && studio.includes('runStudioImage('));
check('D9 Streaming-Hinweis wird nur mit Zwischenbild gezeigt',
  studio.includes('data-testid="image-studio-stream-hint"') && studio.includes('{streamPreview && <p data-testid="image-studio-stream-hint"'));
check('D10 Timeout-Text bleibt dynamisch (%s + Konstante)',
  studio.includes("t.image_studio_error_timeout.replace('%s', String(IMAGE_CLIENT_TIMEOUT_MS / 1000))"));
check('D11 Route ist in Prod- und Dev-Server verdrahtet',
  read('vercel-entry.ts').includes('handleImageStreamApi') &&
  read('serve.ts').includes('handleImageStreamApi') &&
  read('vercel-entry.ts').includes('imageStreamResponse') &&
  read('serve.ts').includes('imageStreamResponse'));

const gen = read('src/ai/image-providers/generate.ts');
check('D12 gpt-image-2 unverändert', gen.includes("const MODEL = 'gpt-image-2'"));
check('D13 exakte Formate unverändert',
  gen.includes("'2:3': '1024x1536'") && gen.includes("'1:1': '1024x1024'") && gen.includes("'4:3': '1152x864'") &&
  gen.includes("'16:9': '1280x720'") && gen.includes("'9:16': '720x1280'"));
check('D14 quality default high (fail-closed) unverändert',
  gen.includes("return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : 'high';"));
check('D15 Text-im-Bild-Regeln unverändert vorhanden',
  read('src/lib/studio-deeplink.ts').includes('IMAGE_PROMPT_RULES') ||
  read('src/i18n/de.ts').includes('image_studio_prompt_rule_overlay'));
// Launch-Fix 2026-10-08 (Variation/Edit-Pfad, gpt-image-2 lehnt input_fidelity ab).
check('D16 input_fidelity NICHT mehr hart verdrahtet — beide Edit-Pfade nutzen den Spread',
  !/^\s+input_fidelity:/m.test(gen) &&
  (gen.match(/\n\s*\.\.\.editFidelityOptions\(\),/g) ?? []).length === 2 &&
  (gen.match(/client\.images\.edit\(\{/g) ?? []).length === 2);
check('D17 Begründung im Code (modellabhängig, gpt-image-2-Ablehnung dokumentiert)',
  gen.includes('modelSupportsInputFidelity') &&
  gen.includes("model === 'gpt-image-1'") &&
  gen.includes('gpt-image-1-only Parameter'));
check('D18 Text→Bild-Pfad unberührt (images.generate ohne editFidelityOptions)',
  (gen.match(/client\.images\.generate\(\{/g) ?? []).length === 2 &&
  !/generate\(\{[\s\S]{0,400}editFidelityOptions/.test(gen));

console.log(`\n=== image-streaming-test: ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) {
  console.log('Fehlgeschlagen: ' + failures.join(' | '));
  process.exit(1);
}

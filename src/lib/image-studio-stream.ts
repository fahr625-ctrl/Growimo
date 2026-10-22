// ── Bild-Studio: SSE-Client für echte Zwischenbilder (Option 1, Owner 2026-10-07) ─
//
// Der Studio-Klick ging bisher über den ServerFn `generateImageServer` — der
// liefert genau EIN serialisiertes Ergebnis, also war das Bild erst nach der
// kompletten Inferenz (~74–90 s, zu ~99 % OpenAI-Zeit, siehe
// docs/bild-performance-analyse-2026-10-07.md) sichtbar. Diese Datei liest
// stattdessen den inkrementellen `text/event-stream` der Route
// `/api/image/stream` (src/api/image-stream.ts) und meldet JEDES Zwischenbild
// sofort über `onPartial` — der Nutzer sieht das Bild entstehen.
//
// Reine, testbare Logik: kein React, kein DOM. `fetchImpl` ist injizierbar,
// damit die Event-Verarbeitung (Reihenfolge `partial` → `done`, Fehler-Event,
// inkrementelles Flushen) ohne Netzwerk und ohne OpenAI-Aufruf geprüft werden
// kann (Test: image-streaming-test.ts).

export interface ImageStreamPartialEvent {
  type: 'partial';
  index: number;
  dataUrl: string;
}

export interface ImageStreamDoneEvent {
  type: 'done';
  url: string;
  mode: string;
  partials: number;
  usedFallback: boolean;
  /** K4-B: Original dauerhaft gespeichert? (fehlt bei alten Servern) */
  saved?: boolean;
  saveReason?: string;
  imageId?: string;
}

export interface ImageStreamErrorEvent {
  type: 'error';
  message: string;
}

export type ImageSseEvent = ImageStreamPartialEvent | ImageStreamDoneEvent | ImageStreamErrorEvent;

/** Die Streaming-Route ist nicht erreichbar (Umgebung ohne die Route, HTML-
 *  Antwort, 404/500) — der Aufrufer darf auf den ServerFn zurückfallen. */
export class ImageStreamUnavailableError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ImageStreamUnavailableError';
    this.status = status;
  }
}

/** Der Server hat den Lauf mit einem `error`-Event beendet (echter Fehler). */
export class ImageStreamServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageStreamServerError';
  }
}

/**
 * Ein SSE-Block → Event. Kommentarzeilen (`: heartbeat`) und alles, was kein
 * bekanntes Event ist, ergeben `null` (wird übersprungen) — fail-closed, damit
 * ein unbekanntes Event nie als Teilbild interpretiert wird.
 */
export function parseSseBlock(block: string): ImageSseEvent | null {
  const dataLines = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const ev = parsed as Record<string, unknown>;
  if (ev.type === 'partial') {
    if (typeof ev.dataUrl !== 'string' || !ev.dataUrl.startsWith('data:image/')) return null;
    return {
      type: 'partial',
      index: typeof ev.index === 'number' ? ev.index : 0,
      dataUrl: ev.dataUrl,
    };
  }
  if (ev.type === 'done') {
    if (typeof ev.url !== 'string' || !ev.url.startsWith('data:image/')) return null;
    return {
      type: 'done',
      url: ev.url,
      mode: typeof ev.mode === 'string' ? ev.mode : 'generate',
      partials: typeof ev.partials === 'number' ? ev.partials : 0,
      usedFallback: ev.usedFallback === true,
      ...(typeof ev.saved === 'boolean' ? { saved: ev.saved } : {}),
      ...(typeof ev.saveReason === 'string' ? { saveReason: ev.saveReason } : {}),
      ...(typeof ev.imageId === 'string' ? { imageId: ev.imageId } : {}),
    };
  }
  if (ev.type === 'error') {
    return {
      type: 'error',
      message: typeof ev.message === 'string' ? ev.message : 'Unbekannter Fehler',
    };
  }
  return null;
}

export interface RunImageStreamArgs {
  /** `projectId` (K4-B, Owner-Freigabe 2026-10-22): optionale Projekt-Zuordnung
   *  für die dauerhafte Speicherung — die Route validiert sie als UUID und legt
   *  das Original mit `generated_images.project_id` ab. Sie berührt WEDER den
   *  Prompt NOCH die Usage-Zählung (1 Bild = 1, unverändert). */
  body: { prompt: string; aspectRatio: string; referenceImageData?: string; projectId?: string };
  onPartial: (partial: { index: number; dataUrl: string }) => void;
  signal?: AbortSignal;
  /** Überschreibbar für Tests (Default: globales fetch). */
  fetchImpl?: typeof fetch;
  url?: string;
  /** Überschreibbar für Tests, um Chunk-Grenzen zu steuern. */
  onRawChunk?: (chunk: string) => void;
}

/**
 * Führt einen Streaming-Lauf aus und gibt das ENDBILD zurück.
 *
 * Wichtig für die UI: `onPartial` wird beim Eintreffen jedes Events aufgerufen,
 * NICHT erst am Ende — der Reader läuft chunkweise. Ein `done` ohne vorherige
 * Partials ist der fail-closed-Fallback des Servers (`usedFallback: true`) und
 * wird unverändert durchgereicht; einen zweiten Modell-Call gibt es nicht.
 */
export async function runImageStream(args: RunImageStreamArgs): Promise<ImageStreamDoneEvent> {
  const doFetch = args.fetchImpl ?? fetch;
  const url = args.url ?? '/api/image/stream';
  const response = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args.body),
    credentials: 'same-origin',
    signal: args.signal,
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
    // HTML-Fehlerseite / 404 / 500 / JSON-Fehler → Route nicht nutzbar.
    let detail = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      if (text && text.length < 300) detail = text;
    } catch {
      /* Body nicht lesbar — Status genügt */
    }
    throw new ImageStreamUnavailableError(detail, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: ImageStreamDoneEvent | null = null;

  // Gibt das `done`-Event zurück (oder null); `partial` geht sofort an onPartial,
  // ein `error`-Event wird geworfen. Bewusst eine Rückgabe statt einer Zuweisung
  // in einer Closure — so bleibt der Typ nach der Schleife sauber eingegrenzt.
  const applyBlock = (block: string): ImageStreamDoneEvent | null => {
    const event = parseSseBlock(block);
    if (!event) return null;
    if (event.type === 'partial') {
      args.onPartial({ index: event.index, dataUrl: event.dataUrl });
      return null;
    }
    if (event.type === 'done') return event;
    throw new ImageStreamServerError(event.message);
  };

  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    const chunk = decoder.decode(value, { stream: true });
    args.onRawChunk?.(chunk);
    buffer += chunk;
    // SSE-Blöcke sind durch eine Leerzeile getrennt; das letzte (unvollständige)
    // Stück bleibt im Puffer, bis der Rest ankommt.
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const blockDone = applyBlock(block);
      if (blockDone) done = blockDone;
    }
  }
  const tail = applyBlock(buffer);
  if (tail) done = tail;

  if (!done) {
    // Abgerissene Verbindung ohne `done`: echter Fehler, KEIN stiller Erfolg.
    throw new ImageStreamServerError('Streaming endete ohne Ergebnis');
  }
  return done;
}

export interface StudioImageRunResult {
  url: string;
  /** true = mindestens ein Zwischenbild kam an (Streaming hat funktioniert). */
  streamed: boolean;
  /** true = klassisch generiert (Server-Fallback bzw. ServerFn-Rückfall). */
  usedFallback: boolean;
  mode: string;
  /** K4-B: dauerhafte Speicherung dieses Originals (undefined = alter Server). */
  saved?: boolean;
  saveReason?: string;
  imageId?: string;
}

/**
 * Studio-Lauf mit ehrlichem Rückfall:
 *   1. Versuch: Streaming-Route (Zwischenbilder sichtbar).
 *   2. Ist die Route selbst nicht verfügbar (Umgebung ohne sie, HTML/404) und
 *      ist KEIN Zwischenbild angekommen, fällt der Lauf auf den bestehenden
 *      ServerFn `generateImageServer` zurück (dort greift dieselbe Quota-/Guard-
 *      Kette). Das hält das Studio in jeder Umgebung funktionsfähig.
 *   3. Kam bereits ein Zwischenbild an, gibt es KEINEN zweiten Aufruf — der
 *      Fehler wird gemeldet (nie zwei bezahlte Läufe für ein Bild).
 */
/**
 * K4-B: Der ServerFn-Rückfall kennt die SSE-Route nicht — sein Ergebnis wird
 * über POST /api/images in denselben Speicherpfad gebracht (gleiche Guard-/Cap-/
 * TTL-Kette). Ein Fehler hier ist NICHT fatal: das Bild bleibt in der Sitzung
 * sichtbar und herunterladbar (K4-A), es wird nur nicht dauerhaft gespeichert.
 */
async function persistFallbackResult(
  url: string,
  body: { prompt: string; aspectRatio: string; projectId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ saved?: boolean; saveReason?: string; imageId?: string }> {
  try {
    const response = await fetchImpl('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        dataUrl: url,
        aspectRatio: body.aspectRatio,
        prompt: body.prompt,
        projectId: body.projectId,
      }),
    });
    const parsed = (await response.json()) as { saved?: boolean; reason?: string; imageId?: string };
    return { saved: parsed.saved === true, saveReason: parsed.reason, imageId: parsed.imageId };
  } catch {
    return { saved: false, saveReason: 'error' };
  }
}

export async function runStudioImage(args: {
  /** `projectId` gehört in den body: so reist es sowohl zum Stream
   *  (`/api/image/stream`) als auch in die Rückfall-Speicherung (`POST /api/images`). */
  body: { prompt: string; aspectRatio: string; referenceImageData?: string; projectId?: string };
  fallback: (signal: AbortSignal) => Promise<{ url: string }>;
  /** K4-B: Vorrang-Override für die Speicherung im Rückfall-Pfad (body.projectId bleibt der Default). */
  projectId?: string;
  onPartial: (partial: { index: number; dataUrl: string }) => void;
  signal: AbortSignal;
  /** Test-Hooks. */
  runStream?: (args: RunImageStreamArgs) => Promise<ImageStreamDoneEvent>;
  fetchImpl?: typeof fetch;
  url?: string;
}): Promise<StudioImageRunResult> {
  const runStream = args.runStream ?? runImageStream;
  let partialCount = 0;
  try {
    const result = await runStream({
      body: args.body,
      onPartial: (partial) => {
        partialCount += 1;
        args.onPartial(partial);
      },
      signal: args.signal,
      fetchImpl: args.fetchImpl,
      url: args.url,
    });
    return {
      url: result.url,
      streamed: !result.usedFallback && result.partials > 0,
      usedFallback: result.usedFallback,
      mode: result.mode,
      saved: result.saved,
      saveReason: result.saveReason,
      imageId: result.imageId,
    };
  } catch (err) {
    if (!(err instanceof ImageStreamUnavailableError) || partialCount > 0) throw err;
    const fallback = await args.fallback(args.signal);
    const saved = await persistFallbackResult(fallback.url, {
      ...args.body,
      projectId: args.projectId ?? args.body.projectId,
    }, args.fetchImpl ?? fetch);
    return { url: fallback.url, streamed: false, usedFallback: true, mode: 'generate', ...saved };
  }
}

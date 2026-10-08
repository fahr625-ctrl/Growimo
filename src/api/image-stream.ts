// ── SSE route POST /api/image/stream (Option 1 Bild-Latenz, Owner 2026-10-07) ──
// Warum eine ROUTE und kein createServerFn: `createServerFn` liefert genau EIN
// serialisiertes Ergebnis zurück — die Zwischenbilder (Partial Images) wären
// damit erst NACH dem Endbild sichtbar und der Streaming-Vorteil wäre weg. Der
// Studio-Aufruf braucht also eine echte, inkrementell flushende HTTP-Antwort.
// Deshalb exakt das bestehende SSE-Muster aus src/api/generate-stream.ts
// (__session-Cookie + JWKS-Verify aus src/api/tracking.ts, Heartbeat,
// ReadableStream → text/event-stream, gleiche Verdrahtung in vercel-entry.ts
// und serve.ts) — kein neuer Auth-Weg, keine zweite Streaming-Technik.
//
// Contract (Client: src/lib/image-studio-stream.ts):
//   • jedes Zwischenbild  → `{"type":"partial","index":n,"dataUrl":"data:image/…"}`
//   • am Ende             → `{"type":"done","url":…,"mode":…,"partials":n,"usedFallback":bool}`
//   • Fehler              → `{"type":"error","message":…}` (danach Ende, kein Hänger)
// Kommentarzeilen `: heartbeat` (alle HEARTBEAT_MS) halten die Verbindung
// während der ~80 s OpenAI-Inferenz offen — sie sind KEINE Events.
//
// Fail-closed (Punkt 3 der Vorgabe): ob streaming geschlappt hat, entscheidet
// allein `generateImageStreaming` (bei Fehlern OHNE vorheriges Zwischenbild
// liefert es intern den klassischen Pfad, `usedFallback: true`). Diese Route
// reicht nur durch und macht KEINEN zweiten Modell-Call.
import { verifySessionSubject } from "./tracking";
import { sanitizeReferenceImageData } from "../ai/image-providers/reference";
import { isImageAspectRatio, type ImageAspectRatio } from "../ai/image-providers/types";
import type { ImageStreamOutcome, ImageStreamPartial } from "../ai/image-providers/generate";

export const IMAGE_STREAM_PATH = "/api/image/stream";

// One active image stream per user (analog generate-stream.ts: billiger
// Doppelklick-Schutz; der harte Schutz bleibt das Monatslimit).
const activeStreams = new Set<string>();

/** Heartbeat gegen Proxy-/Idle-Timeouts (die Inferenz dauert ~74–90 s). */
const HEARTBEAT_MS = 15_000;

export type ImageSseEvent =
  | { type: "partial"; index: number; dataUrl: string }
  | {
      type: "done";
      url: string;
      mode: ImageStreamOutcome["mode"];
      partials: number;
      usedFallback: boolean;
    }
  | { type: "error"; message: string };

function sseEncode(event: ImageSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function sseHeaders(): Headers {
  return new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

export interface ImageStreamBody {
  prompt: string;
  aspectRatio: string;
  referenceImageData?: string;
}

/** Body-Validierung identisch streng wie der ServerFn-Validator im Studio. */
export function parseImageStreamBody(body: unknown): ImageStreamBody | { error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return { error: "prompt is required" };
  const aspectRatio = isImageAspectRatio(raw.aspectRatio) ? raw.aspectRatio : "1:1";
  return {
    prompt,
    aspectRatio,
    referenceImageData: sanitizeReferenceImageData(raw.referenceImageData),
  };
}

/**
 * Der eigentliche Event-Pfad — bewusst als eigene, exportierte Funktion, damit
 * die Reihenfolge-Garantie (partials VOR done, inkrementell geflusht) ohne
 * Netzwerk und ohne OpenAI-Aufruf getestet werden kann (Test-Hook `generate`).
 */
export async function emitImageStreamEvents(args: {
  body: ImageStreamBody;
  send: (event: ImageSseEvent) => void;
  /** Test-Hook; Default = echte gpt-image-2-Streaming-Funktion. */
  generate?: (onPartial: (partial: ImageStreamPartial) => void) => Promise<ImageStreamOutcome>;
}): Promise<ImageStreamOutcome> {
  const generate =
    args.generate ??
    (async (onPartial) => {
      const mod = await import("../ai/image-providers/generate");
      return mod.generateImageStreaming(
        args.body.prompt,
        args.body.aspectRatio as ImageAspectRatio,
        args.body.referenceImageData,
        onPartial,
      );
    });

  // Jedes Zwischenbild geht SOFORT raus (kein Puffern bis zum Ende).
  const outcome = await generate((partial) => {
    args.send({ type: "partial", index: partial.index, dataUrl: partial.dataUrl });
  });
  args.send({
    type: "done",
    url: outcome.url,
    mode: outcome.mode,
    partials: outcome.partials,
    usedFallback: outcome.usedFallback,
  });
  return outcome;
}

export async function handleImageStreamApi(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== IMAGE_STREAM_PATH) return null;
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Auth FIRST (vor dem Öffnen des Streams): __session-Cookie + JWKS-Verify.
  const subject = await verifySessionSubject(req);
  if (!subject) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = parseImageStreamBody(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  if (activeStreams.has(subject)) {
    return Response.json({ error: "Stream already running" }, { status: 429 });
  }
  try {
    const { assertRateOk } = await import("../lib/usage-guard");
    await assertRateOk(subject);
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Zu viele Anfragen. Bitte einen Moment warten.",
      },
      { status: 429 },
    );
  }
  activeStreams.add(subject);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: ImageSseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch {
          // Client ist weg — ab hier nichts mehr schreiben.
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);
      try {
        // Phase 8.2 — 1 Bild = 1 Generierung: identische Quota-Kette wie der
        // ServerFn-Pfad (withGenerationGuard reserviert atomar und kompensiert
        // bei Fehlern → netto 0 bei Fehlschlag). Owner-Override bleibt.
        const { withGenerationGuard } = await import("../lib/usage-guard");
        await withGenerationGuard(subject, () =>
          emitImageStreamEvents({ body: parsed, send }),
        );
      } catch (err) {
        // Ehrlicher Fehler statt Zombie-Promise: der Client bekommt ein
        // `error`-Event, danach wird der Stream geschlossen.
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unbekannter Fehler",
        });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        activeStreams.delete(subject);
        try {
          controller.close();
        } catch {
          // bereits geschlossen/fehlerhaft — unkritisch
        }
      }
    },
    cancel() {
      activeStreams.delete(subject);
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders() });
}

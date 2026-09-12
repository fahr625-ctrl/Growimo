// ── SSE route POST /api/generate/stream (strategy generation, Phase 1) ─────
// Same-origin POST with __session-cookie auth (Clerk JWKS verify reused from
// src/api/tracking.ts — NO new auth code). Streams `started` / `step` /
// `result` / `error` / `done` events (see src/ai/stream.ts) as
// `text/event-stream`. Validation mirrors generateContentServer in
// src/ai/server.ts. Wired into vercel-entry.ts (prod) + serve.ts (dev) BEFORE
// the SSR handler, same pattern as handleBetaApi/handleTrackingApi.
//
// Dummy long-runner mode (Plan §4-R9, deterministic tests WITHOUT LLM):
// POST { ..., dummy: true, dummyDelayMs?: number, dummyFailChannel?: string }
// emits started/running, waits dummyDelayMs per channel sequentially-ish
// (staggered so events arrive progressively), then emits one synthetic result
// per channel (optionally an `error` for dummyFailChannel). Requires auth too.
// Opt-in test hook, no production effect.
import { verifySessionSubject } from "./tracking";
import { runStrategyStream, stepIdFor, type StreamEvent } from "../ai/stream";
import type { ContentRequest, ContentType } from "../ai/types";

const STREAM_PATH = "/api/generate/stream";

// One active stream per user (Plan §4-R3 duplicate-execution guard, same
// in-memory pattern as beta.ts's betaRate — resets on cold start, fine).
const activeStreams = new Set<string>();

// Heartbeat interval so proxies don't kill the idle connection (Plan §4-R2).
const HEARTBEAT_MS = 15_000;

function sseEncode(event: StreamEvent): string {
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

interface ParsedStreamBody {
  requests: ContentRequest[];
  dummy: boolean;
  dummyDelayMs: number;
  dummyFailChannel: string | null;
}

function parseBody(body: unknown): ParsedStreamBody | { error: string } {
  if (!body || typeof body !== "object") return { error: "requests are required" };
  const b = body as Record<string, unknown>;
  const raw = b.requests;
  if (!Array.isArray(raw) || raw.length === 0) return { error: "requests are required" };
  if (raw.length > 10) return { error: "too many requests" };
  const requests: ContentRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "contentType is required" };
    const r = item as Record<string, unknown>;
    if (typeof r.contentType !== "string" || !r.contentType) return { error: "contentType is required" };
    if (typeof r.productIdea !== "string" || !r.productIdea) return { error: "productIdea is required" };
    requests.push({
      contentType: r.contentType as ContentType,
      productIdea: r.productIdea,
      tone: typeof r.tone === "string" ? r.tone : undefined,
      additionalContext: typeof r.additionalContext === "string" ? r.additionalContext : undefined,
    });
  }
  const dummy = b.dummy === true;
  const delayRaw = Number(b.dummyDelayMs);
  const dummyDelayMs = dummy && Number.isFinite(delayRaw) && delayRaw >= 0
    ? Math.min(Math.round(delayRaw), 60_000)
    : 300;
  const dummyFailChannel =
    dummy && typeof b.dummyFailChannel === "string" && b.dummyFailChannel
      ? b.dummyFailChannel
      : null;
  return { requests, dummy, dummyDelayMs, dummyFailChannel };
}

function dummyResult(req: ContentRequest, runSeq: number) {
  return {
    contentType: req.contentType,
    title: `Dummy ${req.contentType} #${runSeq}`,
    body: `Dummy body for ${req.contentType} — Produkt: ${req.productIdea.slice(0, 60)}`,
    metadata: { dummy: true },
    score: null,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function handleGenerateStreamApi(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== STREAM_PATH) return null;
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Auth FIRST (before opening the stream): __session cookie + JWKS verify.
  const subject = await verifySessionSubject(req);
  if (!subject) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = parseBody(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // Duplicate-execution guard: reject a 2nd stream while one is active (R3).
  if (activeStreams.has(subject)) {
    return Response.json({ error: "Stream already running" }, { status: 429 });
  }
  // Phase 8.2 — grobe Rate-Drossel: min. 2 s zwischen zwei Generierungs-
  // Aktionen desselben Nutzers (DB-basiert, atomar). Verhindert Serien-Klicks;
  // der eigentliche harte Schutz ist das Monatslimit (Free 5 / Pro 200).
  try {
    const { assertRateOk } = await import("../lib/usage-guard");
    await assertRateOk(subject);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Zu viele Anfragen. Bitte einen Moment warten." },
      { status: 429 },
    );
  }
  activeStreams.add(subject);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch {
          // Client went away — stop writing.
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Client went away — the finally block clears the interval.
        }
      }, HEARTBEAT_MS);
      try {
        if (parsed.dummy) {
          // Deterministic dummy long-runner: staggered delays, synthetic results.
          const runId = `run_dummy_${Date.now().toString(36)}`;
          send({ type: "started", runId, totalSteps: parsed.requests.length });
          parsed.requests.forEach((r, i) => {
            send({
              type: "step",
              stepId: stepIdFor(r.contentType),
              title: r.contentType,
              status: "running",
              order: i,
            });
          });
          for (let i = 0; i < parsed.requests.length; i++) {
            const r = parsed.requests[i]!;
            await sleep(parsed.dummyDelayMs);
            const stepId = stepIdFor(r.contentType);
            if (parsed.dummyFailChannel === r.contentType) {
              send({ type: "step", stepId, title: r.contentType, status: "error", durationMs: parsed.dummyDelayMs, order: i });
              send({ type: "error", stepId, message: "Dummy failure for " + r.contentType });
              continue;
            }
            send({ type: "step", stepId, title: r.contentType, status: "done", durationMs: parsed.dummyDelayMs, order: i });
            send({ type: "result", stepId, result: dummyResult(r, i) });
          }
          send({ type: "done", runId });
        } else {
          // Phase 8.2 — userId an den Kanal-Runner: jeder erfolgreiche Kanal
          // verbraucht 1 Generierung (Guard liegt in src/ai/stream.ts).
          await runStrategyStream(parsed.requests, send, { userId: subject });
        }
      } catch (err) {
        try {
          send({
            type: "fatal",
            message: err instanceof Error ? err.message : "Unbekannter Fehler",
          });
        } catch {
          // ignore — connection already gone
        }
      } finally {
        clearInterval(heartbeat);
        activeStreams.delete(subject);
        try {
          controller.close();
        } catch {
          // already closed / errored — fine
        }
      }
    },
    cancel() {
      activeStreams.delete(subject);
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders() });
}

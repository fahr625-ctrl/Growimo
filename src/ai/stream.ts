// ── SSE pipeline orchestrator for the strategy generation (Phase 1) ─────────
// Runs the SAME 5 channels IN PARALLEL via the EXISTING generateContent engine
// (src/ai/generate.ts — prompts, max_tokens, scoring F1, metric-guard: all
// untouched) and emits events to the caller. The caller (src/api/generate-stream.ts)
// serializes them as Server-Sent Events.
//
// Event protocol (one JSON object per SSE `data:` line):
//   { type: "started", runId, totalSteps }
//   { type: "step", stepId, title, status: "running" }
//   { type: "step", stepId, title, status: "done"|"error", durationMs }
//   { type: "result", stepId, result }          — complete ContentResult per channel
//   { type: "error", stepId, message }          — channel failure (isolated, NOT fatal)
//   { type: "fatal", message }                  — whole-pipeline failure
//   { type: "done", runId }
//
// Channel errors are treated exactly as today: as a channel-null (same pattern
// as the F4 package path `channels[x] = null`) — the rest keeps running.
// Phase 2 (`partial` events) is EXPLICITLY out of scope here.
import type { ContentRequest, ContentResult, ContentType } from "./types";
import { getContentTypeConfig } from "./content-types";

export type StreamStepStatus = "running" | "done" | "error";

export type StreamEvent =
  | { type: "started"; runId: string; totalSteps: number }
  | { type: "step"; stepId: string; title: string; status: StreamStepStatus; durationMs?: number; order: number }
  | { type: "result"; stepId: string; result: ContentResult }
  | { type: "error"; stepId: string; message: string }
  | { type: "fatal"; message: string }
  | { type: "done"; runId: string };

export type StreamEmit = (event: StreamEvent) => void;

/** stepId for a channel request — stable, client-addressable. */
export function stepIdFor(contentType: ContentType): string {
  return `channel:${contentType}`;
}

function channelTitle(contentType: ContentType): string {
  return getContentTypeConfig(contentType)?.label ?? contentType;
}

function newRunId(): string {
  return (
    "run_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

export interface RunStrategyStreamOptions {
  /** Override the run id (tests / determinism). */
  runId?: string;
  /** Injectable runner — defaults to the real generateContent engine. */
  runner?: (req: ContentRequest) => Promise<ContentResult>;
}

/**
 * Run the strategy pipeline exactly as today (all channel runners in parallel
 * via Promise.all) and emit progress events. Resolves with the collected
 * results in REQUEST order (same order as the legacy Promise.all path).
 * A failing channel yields an `error` event + null slot (NOT a throw) — only
 * an unexpected orchestrator failure throws (mapped to `fatal` by the route).
 */
export async function runStrategyStream(
  requests: ContentRequest[],
  emit: StreamEmit,
  options: RunStrategyStreamOptions = {},
): Promise<Array<ContentResult | null>> {
  const runId = options.runId ?? newRunId();
  const runner =
    options.runner ??
    (async (req: ContentRequest) => {
      // Dynamic import keeps the client bundle free of the server-side engine.
      const { generateContent } = await import("./generate");
      return generateContent(req);
    });

  emit({ type: "started", runId, totalSteps: requests.length });

  const startedAt = requests.map(() => Date.now());
  requests.forEach((req, i) => {
    emit({
      type: "step",
      stepId: stepIdFor(req.contentType),
      title: channelTitle(req.contentType),
      status: "running",
      order: i,
    });
  });

  const outcomes = await Promise.all(
    requests.map(async (req, i): Promise<ContentResult | null> => {
      const stepId = stepIdFor(req.contentType);
      try {
        const result = await runner(req);
        emit({
          type: "step",
          stepId,
          title: channelTitle(req.contentType),
          status: "done",
          durationMs: Date.now() - startedAt[i],
          order: i,
        });
        emit({ type: "result", stepId, result });
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unbekannter Fehler";
        emit({
          type: "step",
          stepId,
          title: channelTitle(req.contentType),
          status: "error",
          durationMs: Date.now() - startedAt[i],
          order: i,
        });
        emit({ type: "error", stepId, message });
        // Channel-null pattern (F4 package path): skip, keep the rest running.
        return null;
      }
    }),
  );

  emit({ type: "done", runId });
  return outcomes;
}

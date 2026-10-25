// Vercel Build Output API function entry.
//
// The Build Output Node launcher invokes the default export as a classic Node
// `(req, res)` handler — NOT a web handler. TanStack Start emits a portable web
// fetch handler (dist/server/server.js), so we adapt: Node IncomingMessage → web
// Request, run the fetch handler, stream the web Response back onto ServerResponse.
// Node 22 has global Request/Response/Headers/ReadableStream.
//
// Bundled (with its deps + the SSR handler's dynamic ./assets chunks) into
// .vercel/output/functions/render.func/index.mjs by build-vercel.sh.
import type { IncomingMessage, ServerResponse } from "node:http";

import handler from "./dist/server/server.js";
import { dbInitState, initDb } from "./src/db/init";
import { handleBetaApi } from "./src/api/beta";
import { handleTrackingApi } from "./src/api/tracking";
import { handleAnalyticsApi } from "./src/api/analytics";
import { handleAdminAnalyticsApi } from "./src/api/admin-analytics";
import { handleGenerateStreamApi } from "./src/api/generate-stream";
import { handleImageStreamApi } from "./src/api/image-stream";
import { handleStripeWebhookApi } from "./src/api/stripe-webhook";
// K4-B (Owner-Freigabe 2026-10-19): dauerhafte Bildspeicherung + TTL-Tageslauf.
import { handleImagesApi } from "./src/api/images";
import { handleCronBlobTtlApi } from "./src/api/cron-blob-ttl";
// Zugriffsschutz der geschützten Klick-Demo (preview.growimo.app): env-gesteuert
// (PREVIEW_AUTH_USER + PREVIEW_AUTH_PASS), in Production wirkungslos.
import { applyPreviewBasicAuth } from "./src/lib/preview-basic-auth";

// Initialise the database once at cold start.
// Fail-LOUD (Incident 2026-10-20): a failed schema init means migrations did NOT
// reach the database — that must never be silent again. initDb() records the
// outcome in a state (it does not throw, so the app can still render), and this
// log line makes the failure visible in the function logs. Routes that need the
// new schema answer fail-closed (503) via dbSchemaReady().
try {
  await initDb();
  const dbInit = dbInitState();
  if (dbInit.status === "ok") {
    console.log(`[vercel] DB schema ready (${dbInit.statements} statements).`);
  } else if (dbInit.status === "skipped") {
    console.log("[vercel] DB schema init skipped — DATABASE_URL not configured.");
  } else if (dbInit.status === "failed") {
    console.error(
      "[vercel] DB SCHEMA NOT INITIALIZED — migrations did not reach the database. code=%s at=%s error=%s",
      dbInit.code ?? "n/a",
      dbInit.at,
      dbInit.error,
    );
  }
} catch (err) {
  console.error("[vercel] DB INIT CRASHED (unexpected):", err);
}

const fetchHandler = handler as {
  fetch: (request: Request) => Response | Promise<Response>;
};

const toWebRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody
      ? { body: req as unknown as ReadableStream, duplex: "half" }
      : {}),
  } as RequestInit);
};

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const webReq = toWebRequest(req);

    // Geschützte Klick-Demo (preview.growimo.app): HTTP-Basic-Auth, NUR aktiv wenn
    // PREVIEW_AUTH_USER und PREVIEW_AUTH_PASS gesetzt sind (in Production nie der
    // Fall → Rückgabe false, kein 401, keine Header, keine Verzögerung).
    // Steht bewusst VOR jedem Handler: /api/*, SSE-Streams, ServerFns und SSR
    // laufen alle durch diesen einen Einstieg. Ausgenommen sind nur der
    // Stripe-Webhook (Signaturprüfung) und der Cron-Lauf (CRON_SECRET).
    if (applyPreviewBasicAuth({ headers: req.headers, url: req.url }, res)) {
      return;
    }

    const url = new URL(webReq.url);
    
    // Stripe-Webhook (Phase 8.3): Signaturprüfung mit rohem Body, 200/400/500.
    // Muss VOR dem SSR-FetchHandler laufen, damit der Body unangetastet bleibt.
    const stripeWebhookResponse = await handleStripeWebhookApi(webReq, url.pathname);
    if (stripeWebhookResponse) {
      res.statusCode = stripeWebhookResponse.status;
      stripeWebhookResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (stripeWebhookResponse.body) {
        const reader = stripeWebhookResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    // Handle beta API routes before passing to SSR handler
    const apiResponse = await handleBetaApi(webReq, url.pathname);
    if (apiResponse) {
      res.statusCode = apiResponse.status;
      apiResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (apiResponse.body) {
        const reader = apiResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    const trackingResponse = await handleTrackingApi(webReq, url.pathname);
    if (trackingResponse) {
      res.statusCode = trackingResponse.status;
      trackingResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (trackingResponse.body) {
        const reader = trackingResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    // Anonymous analytics events (no owner gate; whitelist + rate-limit inside).
    const analyticsResponse = await handleAnalyticsApi(webReq, url.pathname);
    if (analyticsResponse) {
      res.statusCode = analyticsResponse.status;
      analyticsResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (analyticsResponse.body) {
        const reader = analyticsResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    // Owner-only admin analytics report (401/403 inside; aggregates only).
    const adminAnalyticsResponse = await handleAdminAnalyticsApi(webReq, url.pathname);
    if (adminAnalyticsResponse) {
      res.statusCode = adminAnalyticsResponse.status;
      adminAnalyticsResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (adminAnalyticsResponse.body) {
        const reader = adminAnalyticsResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    // SSE image-generation stream (Option 1 Bild-Latenz): echte Zwischenbilder.
    const imageStreamResponse = await handleImageStreamApi(webReq, url.pathname);
    if (imageStreamResponse) {
      res.statusCode = imageStreamResponse.status;
      imageStreamResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (imageStreamResponse.body) {
        const reader = imageStreamResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    // SSE strategy-generation stream (chunked; same reader/write forwarding).
    const streamResponse = await handleGenerateStreamApi(webReq, url.pathname);
    if (streamResponse) {
      res.statusCode = streamResponse.status;
      streamResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (streamResponse.body) {
        const reader = streamResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    
    // K4-B: Bild-Meta-Liste, Original-Download und Löschen (/api/images[/<id>]).
    const imagesResponse = await handleImagesApi(webReq, url.pathname);
    if (imagesResponse) {
      res.statusCode = imagesResponse.status;
      imagesResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (imagesResponse.body) {
        const reader = imagesResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    // K4-B: Tageslauf für abgelaufene Bilder (nur mit CRON_SECRET, fail-closed 401).
    const cronBlobTtlResponse = await handleCronBlobTtlApi(webReq, url.pathname);
    if (cronBlobTtlResponse) {
      res.statusCode = cronBlobTtlResponse.status;
      cronBlobTtlResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (cronBlobTtlResponse.body) {
        const reader = cronBlobTtlResponse.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }

    const webRes = await fetchHandler.fetch(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    // Log the detail server-side (captured by the host's function logs); never
    // return a stack trace to the public visitor of the site.
    console.error("[team-site] SSR request failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}

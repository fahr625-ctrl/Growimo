// ─────────────────────────────────────────────────────────────────────────────
// Phase 8.3c — Lokale Testmodus-Instanz für das Stripe-E2E (KEIN Production-
// Deploy). Fork von serve.ts: bindet auf 127.0.0.1:<PORT> (Default 3188) statt
// 0.0.0.0:3000 und übernimmt KEINE Port-Freigabe (der :3000-Plattform-Server
// wird nicht angefasst — `bun serve.ts` dort ist bewusst verboten).
//
// Nutzung (Repo-Wurzel, echte Test-DB + Weberhook-Secret via Umgebung):
//   STRIPE_WEBHOOK_SECRET=<whsec...> PORT=3188 \
//     bun --env-file=.env stripe83-local-server.ts
//
// Der Server mountet exakt die Produktions-Wiring-Reihenfolge aus serve.ts
// (Webhook → Beta/Tracking/Analytics/Stream-API → dist-SSR-Handler) und dient
// dem E2E-Skript stripe83-e2e.ts als Ziel (ServerFn-HTTP-Pfade + Webhook).
// STRIPE_SECRET_KEY ist optional: ist er gesetzt, laufen die echten
// Stripe-API-Pfade (Checkout/Portal/Webhook-Retrieve) — sonst greift der
// dokumentierte Fail-closed-Pfad (500 „Stripe is not configured").
// ─────────────────────────────────────────────────────────────────────────────
import handler from "./dist/server/server.js";
import { initDb } from "./src/db/init";
import { handleBetaApi } from "./src/api/beta";
import { handleTrackingApi } from "./src/api/tracking";
import { handleAnalyticsApi } from "./src/api/analytics";
import { handleAdminAnalyticsApi } from "./src/api/admin-analytics";
import { handleGenerateStreamApi } from "./src/api/generate-stream";
import { handleStripeWebhookApi } from "./src/api/stripe-webhook";

try {
  await initDb();
} catch (err) {
  console.error("[stripe83-local-server] Database init failed — continuing:", err);
}

const PORT = Number(process.env.PORT ?? 3188);
const HOST = "127.0.0.1";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

console.log(`[stripe83-local-server] listening on http://${HOST}:${PORT} (STRIPE_SECRET_KEY ${process.env.STRIPE_SECRET_KEY ? "set" : "NOT set"}, STRIPE_WEBHOOK_SECRET ${process.env.STRIPE_WEBHOOK_SECRET ? "set" : "NOT set"})`);

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const stripeWebhookResponse = await handleStripeWebhookApi(req, pathname);
    if (stripeWebhookResponse) return stripeWebhookResponse;
    const apiResponse = await handleBetaApi(req, pathname);
    if (apiResponse) return apiResponse;
    const trackingResponse = await handleTrackingApi(req, pathname);
    if (trackingResponse) return trackingResponse;
    const analyticsResponse = await handleAnalyticsApi(req, pathname);
    if (analyticsResponse) return analyticsResponse;
    const adminAnalyticsResponse = await handleAdminAnalyticsApi(req, pathname);
    if (adminAnalyticsResponse) return adminAnalyticsResponse;
    const streamResponse = await handleGenerateStreamApi(req, pathname);
    if (streamResponse) return streamResponse;
    if (pathname !== "/") {
      const file = Bun.file(CLIENT_DIR + pathname);
      if (await file.exists()) return new Response(file);
    }
    return (
      handler as { fetch: (r: Request) => Response | Promise<Response> }
    ).fetch(req);
  },
});

// Keep the process alive (Bun.serve runs forever; this guard is for safety).
await new Promise(() => {});
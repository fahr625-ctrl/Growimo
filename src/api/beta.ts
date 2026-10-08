import { getDb } from "../db/index";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifySessionSubject } from "./tracking";
import { OWNER_USER_ID } from "../lib/tracking";

// In-memory rate limiter (resets on cold start — fine for beta)
const betaRate = new Map<string, { count: number; at: number }>();

// ── Clerk session verification (networkless) ────────────────────────────────
// Clerk's backend endpoint POST /v1/tokens/verify no longer exists (404), and
// POST /v1/sessions/{id}/verify is deprecated (410). The supported method is
// networkless JWT verification: check the __session token's signature against
// the Clerk instance's JWKS. The instance origin is encoded in the publishable
// key (pk_test_<base64> decodes to "<origin>$...").
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function clerkFrontendApiOrigin(): string | null {
  const pk = process.env.VITE_CLERK_PUBLISHABLE_KEY || "";
  if (!pk.startsWith("pk_")) return null;
  try {
    const decoded = Buffer.from(pk.slice("pk_test_".length), "base64").toString("utf8");
    const origin = decoded.split("$")[0];
    return origin ? (origin.startsWith("http") ? origin : `https://${origin}`) : null;
  } catch { return null; }
}

function getJWKS() {
  const origin = clerkFrontendApiOrigin();
  if (!origin) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${origin}/.well-known/jwks.json`));
  return jwks;
}

async function verifyClerkSession(req: Request): Promise<boolean> {
  const sessionToken = req.headers.get("cookie")?.split(";").find(c=>c.trim().startsWith("__session="))?.split("=")[1];
  if (!sessionToken) return false;
  try {
    const origin = clerkFrontendApiOrigin();
    const keys = getJWKS();
    if (!origin || !keys) return false;
    await jwtVerify(sessionToken, keys, { issuer: origin });
    return true;
  } catch { return false; }
}

export async function handleBetaApi(req: Request, pathname: string): Promise<Response | null> {
  if (pathname !== "/api/beta-signup" && pathname !== "/api/beta-signups" && pathname !== "/api/beta-access") return null;
  const sql = getDb();

  if (pathname === "/api/beta-signups") {
    // Owner-only: PII protection — full waitlist visible only to the owner.
    // Same pattern as handleTrackingApi (verifySessionSubject, then sub check).
    const sub = await verifySessionSubject(req);
    if (!sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (sub !== OWNER_USER_ID) return Response.json({ error: "Forbidden" }, { status: 403 });
    const rows = await sql`SELECT id, first_name, email, approved, created_at FROM beta_signups ORDER BY created_at DESC`;
    return Response.json({ signups: rows });
  }

  if (pathname === "/api/beta-access") {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    if (!(await verifyClerkSession(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return Response.json({ error: "Email is required" }, { status: 400 });
    const approved = await isBetaUserEmail(email);
    return Response.json({ approved });
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const now = Date.now();
  const prior = betaRate.get(ip);
  if (prior && now - prior.at < 60000 && prior.count >= 3) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!prior || now - prior.at >= 60000) betaRate.set(ip, { count: 1, at: now });
  else prior.count++;

  // ── BETA-ENDE (Owner-Auftrag 2026-10-08, Phase 10-Vorbereitung) ────────────
  // Das Beta-Programm ist beendet: neue Anmeldungen werden NICHT mehr
  // angenommen. Der frühere Pfad schrieb hartkodiert `approved = true` und hat
  // damit jeder beliebigen neuen E-Mail den lebenslangen 50-%-Pro-Rabatt
  // geöffnet (das Rabatt-Loch). Jetzt: HTTP 410 Gone, KEIN INSERT in
  // beta_signups, KEINE Notification, keine Validierung/kein Body-Read.
  //
  // Der bestehende Rabatt bleibt unberührt: `isBetaUserEmail()` (unten) und
  // /api/beta-access lesen weiterhin ausschließlich die bereits vor dem Public
  // Launch registrierten Zeilen (beta_signups approved = true). Bestehende
  // Zeilen werden nicht angefasst.
  return Response.json(
    {
      error: "Beta program ended",
      code: "beta_program_ended",
      message: "Das Beta-Programm ist beendet. Du kannst dich direkt kostenlos registrieren.",
      message_en: "The beta program has ended. You can sign up for free right away.",
    },
    { status: 410 },
  );
}

/**
 * Phase 8.3: Beta-Berechtigung („lebenslange 50 % auf Pro" für vor-Public-Launch
 * registrierte Beta-Nutzer). Matcht die (SIGNED-IN) E-Mail gegen beta_signups
 * (approved=true) — identische Semantik wie der /api/beta-access-Endpunkt.
 * Server-seitig resolviert (Checkout/UI), damit der Rabatt nie vom Client
 * behauptet werden kann (fail-closed: ohne Treffer → false).
 */
export async function isBetaUserEmail(email: string | null | undefined): Promise<boolean> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  const sql = getDb();
  const rows = await sql`SELECT id FROM beta_signups WHERE LOWER(email) = ${normalized} AND approved = true LIMIT 1`;
  return rows.length > 0;
}

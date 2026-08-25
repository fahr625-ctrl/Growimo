// ── Admin-only beta-tracking aggregate API (Clerk-session + owner gate) ────
// Pattern: mirrors src/api/beta.ts — a plain JSON route wired into serve.ts and
// vercel-entry.ts. Unlike a createServerFn, here we can read the __session cookie
// and verify it networkless against the Clerk JWKS, then extract the session's
// subject (sub = Clerk user id) and require it to be the owner. Anyone else gets
// 401 (no session) or 403 (session but not owner).
import { createRemoteJWKSet, jwtVerify } from "jose";
import { qGetTrackingReport } from "../db/queries";
import { OWNER_USER_ID, TEST_USER_IDS } from "../lib/tracking";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function clerkFrontendApiOrigin(): string | null {
  const pk = process.env.VITE_CLERK_PUBLISHABLE_KEY || "";
  if (!pk.startsWith("pk_")) return null;
  try {
    const decoded = Buffer.from(pk.slice("pk_test_".length), "base64").toString("utf8");
    const origin = decoded.split("$")[0];
    return origin ? (origin.startsWith("http") ? origin : `https://${origin}`) : null;
  } catch {
    return null;
  }
}
function getJWKS() {
  const origin = clerkFrontendApiOrigin();
  if (!origin) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${origin}/.well-known/jwks.json`));
  return jwks;
}
/** Returns the Clerk subject (user id) if the __session token verifies, else null. */
async function verifySessionSubject(req: Request): Promise<string | null> {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.split(";").find((c) => c.trim().startsWith("__session="));
  if (!match) return null;
  const sessionToken = match.split("=").slice(1).join("=");
  if (!sessionToken) return null;
  try {
    const origin = clerkFrontendApiOrigin();
    const keys = getJWKS();
    if (!origin || !keys) return null;
    const { payload } = await jwtVerify(sessionToken, keys, { issuer: origin });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function handleTrackingApi(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/admin-tracking") {
    return null;
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const sub = await verifySessionSubject(req);
  if (!sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (sub !== OWNER_USER_ID) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  // rangeDays: number window — all = unlimited.
  let rangeDays: number | null = 30;
  if (body.rangeDays === "all" || body.rangeDays === null || body.rangeDays === undefined) {
    rangeDays = null;
  } else {
    const n = Number(body.rangeDays);
    rangeDays = Number.isFinite(n) && n > 0 ? n : null;
  }
  // Hide own(test) activity by default (filter approach, owner-approved).
  const hideOwnerTest = body.hideOwnerTest !== false;
  const excludeUserIds = hideOwnerTest ? TEST_USER_IDS : [];
  const report = await qGetTrackingReport(rangeDays, excludeUserIds);
  return Response.json(report);
}

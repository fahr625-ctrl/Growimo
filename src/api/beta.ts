import { getDb } from "../db/index";

// In-memory rate limiter (resets on cold start — fine for beta)
const betaRate = new Map<string, { count: number; at: number }>();

async function verifyClerkSession(req: Request): Promise<boolean> {
  const sessionToken = req.headers.get("cookie")?.split(";").find(c=>c.trim().startsWith("__session="))?.split("=")[1];
  if (!sessionToken) return false;
  try {
    const verify = await fetch("https://api.clerk.com/v1/tokens/verify", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ token: sessionToken }),
    });
    return verify.ok;
  } catch { return false; }
}

export async function handleBetaApi(req: Request, pathname: string): Promise<Response | null> {
  if (pathname !== "/api/beta-signup" && pathname !== "/api/beta-signups" && pathname !== "/api/beta-access") return null;
  const sql = getDb();

  if (pathname === "/api/beta-signups") {
    // Verify Clerk session via __session cookie
    if (!(await verifyClerkSession(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
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
    const rows = await sql`SELECT id FROM beta_signups WHERE LOWER(email) = ${email} AND approved = true LIMIT 1`;
    return Response.json({ approved: rows.length > 0 });
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const now = Date.now();
  const prior = betaRate.get(ip);
  if (prior && now - prior.at < 60000 && prior.count >= 3) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!prior || now - prior.at >= 60000) betaRate.set(ip, { count: 1, at: now });
  else prior.count++;

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const first = String(body.first_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!first) return Response.json({ error: "First name is required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Invalid email" }, { status: 400 });

  // Idempotent: reuse existing row if this email already signed up
  const existing = await sql`SELECT id, first_name, email, created_at FROM beta_signups WHERE LOWER(email) = ${email} LIMIT 1`;
  if (existing.length > 0) {
    console.log(`[beta] Duplicate signup ignored: ${existing[0].first_name} <${email}>`);
    return Response.json({ success: true, signup: existing[0], already: true });
  }

  const rows = await sql`INSERT INTO beta_signups (first_name,email,approved) VALUES (${first},${email},true) RETURNING id,created_at`;
  console.log(`[beta] New signup: ${first} <${email}>`);

  // Write to notification queue for email delivery
  try { const fd = await import("fs"); fd.appendFileSync("/home/team/shared/beta-notifications.jsonl", JSON.stringify({first_name:first,email,created_at:rows[0].created_at,ts:new Date().toISOString()})+"\n"); } catch {}

  return Response.json({ success: true, signup: rows[0], already: false });
}

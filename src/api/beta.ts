import { getDb } from "../db/index";

// In-memory rate limiter (resets on cold start — fine for beta)
const betaRate = new Map<string, { count: number; at: number }>();

export async function handleBetaApi(req: Request, pathname: string): Promise<Response | null> {
  if (pathname !== "/api/beta-signup" && pathname !== "/api/beta-signups") return null;
  const sql = getDb();

  if (pathname === "/api/beta-signups") {
    // Verify Clerk session via __session cookie
    const sessionToken = req.headers.get("cookie")?.split(";").find(c=>c.trim().startsWith("__session="))?.split("=")[1];
    if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const verify = await fetch("https://api.clerk.com/v1/tokens/verify", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ token: sessionToken }),
      });
      if (!verify.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
    } catch { return Response.json({ error: "Unauthorized" }, { status: 401 }); }
    const rows = await sql`SELECT id, first_name, email, created_at FROM beta_signups ORDER BY created_at DESC`;
    return Response.json({ signups: rows });
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

  const rows = await sql`INSERT INTO beta_signups (first_name,email) VALUES (${first},${email}) RETURNING id,created_at`;
  console.log(`[beta] New signup: ${first} <${email}>`);

  // Write to notification queue for email delivery
  try { const fd = await import("fs"); fd.appendFileSync("/home/team/shared/beta-notifications.jsonl", JSON.stringify({first_name:first,email,created_at:rows[0].created_at,ts:new Date().toISOString()})+"\n"); } catch {}

  return Response.json({ success: true, signup: rows[0] });
}

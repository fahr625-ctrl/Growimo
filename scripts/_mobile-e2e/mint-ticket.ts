/* Mint a fresh Clerk sign-in token for an EXISTING user (keeps the user).
 * Run: bun --env-file=.env scripts/_mobile-e2e/mint-ticket.ts <clerk_user_id>
 * Writes /tmp/mobile-e2e-ticket.txt */
import fs from "fs";
const SECRET = process.env.CLERK_SECRET_KEY!;
const userId = process.argv[2];
if (!userId) { console.log("usage: mint-ticket.ts <clerkUserId>"); process.exit(1); }
if (!SECRET || !SECRET.startsWith("sk_test_")) { console.log("ABORT: no sk_test_ CLERK_SECRET_KEY"); process.exit(1); }
const res = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify({ user_id: userId, expires_in_seconds: 3600 }),
});
const j: any = await res.json().catch(() => null);
if (res.status !== 200 || !j?.token) { console.log("TOKEN FAIL", res.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
fs.writeFileSync("/tmp/mobile-e2e-ticket.txt", j.token);
console.log("TOKEN_OK user=" + userId + " len=" + j.token.length);

/* ⚠️ VERALTET (Owner-Sicherheitsregel 2026-10-12): nutzt eine hartkodierte alte Test-User-ID und
 * keinen der heute gültigen Wege. Für E2E-Logins NICHT mehr verwenden — stattdessen
 * `bun --env-file=.env run scripts/e2e-testkonto.ts token` (liest das dedizierte Testkonto aus
 * /home/team/shared/e2e/testkonto.env, Production-Instanz, CLERK_SECRET_KEY_PROD).
 * Das Owner-Konto darf nicht mehr für Tests verwendet werden. Siehe /home/team/shared/e2e/README-2026-10-12.md */
const SECRET = process.env.CLERK_SECRET_KEY!;
const API = "https://api.clerk.com/v1";
const USER_ID = "user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo";
const fs = await import("fs");
async function main(){
  const res = await fetch(`${API}/sign_in_tokens`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${SECRET}`},body:JSON.stringify({user_id:USER_ID,expires_in_seconds:3600})});
  const j = await res.json();
  const token = j.token;
  fs.writeFileSync("/home/team/shared/e2e/ticket.txt", token||"");
  console.log("TOKEN_LEN",(token||"").length, "status", res.status);
}
main().catch(e=>{console.error(e);process.exit(1);});

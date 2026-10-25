// ── Zugriffsschutz der geschützten Klick-Demo (preview.growimo.app) ──────────
// Lauf: bun run preview-basic-auth-test.ts
//
// Konzept: /home/team/shared/klick-demo-2026-10-25/ZUGRIFFSSCHUTZ-KONZEPT.md
// (Variante 2). Geprüft wird:
//   (a) Envs gesetzt + gültige Credentials        → Request läuft durch
//   (b) Envs gesetzt + fehlende/falsche Credentials → 401 + WWW-Authenticate
//   (c) Envs NICHT gesetzt                        → Verhalten unverändert
//       (kein 401, kein Header, kein res.end(), kein Statuscode-Eingriff)
//   (d) Stripe-Webhook + Cron-Pfad                → auch ohne Credentials durch
//   (+) Konstantzeit-Vergleich (timingSafeEqual, kein früher Abbruch),
//       Ausnahmeliste == echte Routen-Konstanten, Verdrahtung in vercel-entry.ts.
import { readFileSync } from "node:fs";

import {
  PREVIEW_AUTH_EXEMPT_PATHS,
  PREVIEW_AUTH_REALM,
  applyPreviewBasicAuth,
  decidePreviewAuth,
  isPreviewAuthExempt,
  normalizePath,
  parseBasicCredentials,
  readPreviewAuthConfig,
  timingSafeStringEqual,
} from "./src/lib/preview-basic-auth";
import { STRIPE_WEBHOOK_PATH } from "./src/api/stripe-webhook";
import { CRON_BLOB_TTL_PATH } from "./src/api/cron-blob-ttl";

let failures = 0;
let checks = 0;
function check(name: string, cond: boolean, detail = "") {
  checks++;
  if (!cond) {
    failures++;
    console.log("FAIL:", name, detail ? `— ${detail}` : "");
  } else {
    console.log("PASS:", name);
  }
}

const USER = "demo";
const PASS = "s3hr-geheim";
const ENV_ON = { PREVIEW_AUTH_USER: USER, PREVIEW_AUTH_PASS: PASS };
const basic = (u: string, p: string) =>
  `Basic ${Buffer.from(`${u}:${p}`, "utf8").toString("base64")}`;

type FakeRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
  ended: boolean;
  setHeader: (n: string, v: string) => void;
  end: (b?: string) => void;
};
function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(n, v) {
      res.headers[n.toLowerCase()] = v;
    },
    end(b) {
      res.ended = true;
      res.body = b;
    },
  };
  return res;
}

// ── (a) Aktiv + gültige Credentials → kommt durch ────────────────────────────
const protectedPaths = [
  "/",
  "/app",
  "/app/dashboard",
  "/api/generate-stream",
  "/api/image/stream",
  "/api/images",
  "/api/tracking",
  "/api/analytics",
  "/api/beta",
  "/api/admin/analytics",
  "/_serverFn/abc123",
];
for (const path of protectedPaths) {
  const res = fakeRes();
  const blocked = applyPreviewBasicAuth(
    { headers: { authorization: basic(USER, PASS) }, url: path },
    res,
    ENV_ON,
  );
  check(
    `(a) gültige Credentials → durch: ${path}`,
    blocked === false && res.ended === false && res.statusCode === 0,
    `blocked=${blocked} status=${res.statusCode}`,
  );
}

// ── (b) Aktiv + fehlende/falsche Credentials → 401 ──────────────────────────
const badCases: Array<{ name: string; auth?: string }> = [
  { name: "kein Authorization-Header" },
  { name: "falsches Passwort", auth: basic(USER, "falsch") },
  { name: "falscher Benutzer", auth: basic("admin", PASS) },
  { name: "beides falsch", auth: basic("x", "y") },
  { name: "leeres Passwort", auth: basic(USER, "") },
  { name: "leerer Benutzer", auth: basic("", PASS) },
  { name: "falsches Schema (Bearer)", auth: `Bearer ${PASS}` },
  { name: "kein Basic-Präfix", auth: Buffer.from(`${USER}:${PASS}`).toString("base64") },
  { name: "kaputter Base64-Wert", auth: "Basic !!!nicht-base64!!!" },
  { name: "ohne Doppelpunkt", auth: `Basic ${Buffer.from("nuruser").toString("base64")}` },
  { name: "leerer Header", auth: "" },
];
for (const c of badCases) {
  const res = fakeRes();
  const blocked = applyPreviewBasicAuth(
    { headers: c.auth === undefined ? {} : { authorization: c.auth }, url: "/app" },
    res,
    ENV_ON,
  );
  check(
    `(b) ${c.name} → 401`,
    blocked === true && res.ended === true && res.statusCode === 401,
    `blocked=${blocked} status=${res.statusCode}`,
  );
  check(
    `(b) ${c.name} → WWW-Authenticate realm="${PREVIEW_AUTH_REALM}"`,
    res.headers["www-authenticate"] ===
      `Basic realm="${PREVIEW_AUTH_REALM}", charset="UTF-8"`,
    String(res.headers["www-authenticate"]),
  );
  check(
    `(b) ${c.name} → no-store + noindex + Textkörper`,
    res.headers["cache-control"] === "no-store" &&
      res.headers["x-robots-tag"] === "noindex" &&
      (res.headers["content-type"] ?? "").startsWith("text/plain") &&
      typeof res.body === "string" &&
      res.body.includes("Demo-Zugangsdaten"),
    JSON.stringify(res.headers),
  );
}

// Falsche Credentials dürfen AUCH auf /api/* und Streams nicht durchkommen.
for (const path of ["/api/generate-stream", "/api/image/stream", "/_serverFn/x"]) {
  const res = fakeRes();
  const blocked = applyPreviewBasicAuth(
    { headers: { authorization: basic(USER, "falsch") }, url: path },
    res,
    ENV_ON,
  );
  check(`(b) falsche Credentials → 401 auch auf ${path}`, blocked === true && res.statusCode === 401);
}

// ── (c) Envs NICHT gesetzt → exakt heutiges Verhalten ───────────────────────
const offEnvs: Array<{ name: string; env: Record<string, string | undefined> }> = [
  { name: "keine Envs", env: {} },
  { name: "nur PREVIEW_AUTH_USER", env: { PREVIEW_AUTH_USER: USER } },
  { name: "nur PREVIEW_AUTH_PASS", env: { PREVIEW_AUTH_PASS: PASS } },
  { name: "leere Strings", env: { PREVIEW_AUTH_USER: "", PREVIEW_AUTH_PASS: "" } },
];
for (const c of offEnvs) {
  for (const path of ["/", "/app", "/api/generate-stream"]) {
    const res = fakeRes();
    const blocked = applyPreviewBasicAuth({ headers: {}, url: path }, res, c.env);
    check(
      `(c) ${c.name}: kein 401/kein Header auf ${path}`,
      blocked === false &&
        res.ended === false &&
        res.statusCode === 0 &&
        Object.keys(res.headers).length === 0,
      `blocked=${blocked} status=${res.statusCode} headers=${JSON.stringify(res.headers)}`,
    );
  }
}
// Ohne Envs auch mit kaputtem/gültigem Header nichts tun.
{
  const res = fakeRes();
  const blocked = applyPreviewBasicAuth(
    { headers: { authorization: "Basic totaler-muell" }, url: "/app" },
    res,
    {},
  );
  check("(c) ohne Envs: auch kaputter Header wird nicht beantwortet", blocked === false && res.ended === false);
}
check("(c) readPreviewAuthConfig({}) === null", readPreviewAuthConfig({}) === null);
check(
  "(c) readPreviewAuthConfig mit beiden Werten liefert sie",
  readPreviewAuthConfig(ENV_ON)?.user === USER && readPreviewAuthConfig(ENV_ON)?.pass === PASS,
);
// Production-Env (process.env ohne die Variablen) → Schutz aus.
{
  const saved = { u: process.env.PREVIEW_AUTH_USER, p: process.env.PREVIEW_AUTH_PASS };
  delete process.env.PREVIEW_AUTH_USER;
  delete process.env.PREVIEW_AUTH_PASS;
  const res = fakeRes();
  const blocked = applyPreviewBasicAuth({ headers: {}, url: "/app" }, res);
  check(
    "(c) process.env ohne Preview-Variablen (Production) → kein 401",
    blocked === false && res.statusCode === 0 && !res.ended,
  );
  if (saved.u !== undefined) process.env.PREVIEW_AUTH_USER = saved.u;
  if (saved.p !== undefined) process.env.PREVIEW_AUTH_PASS = saved.p;
}

// ── (d) Webhook + Cron ohne Credentials durch ──────────────────────────────
check(
  "(d) Ausnahmeliste == echte Routen-Konstanten",
  PREVIEW_AUTH_EXEMPT_PATHS.length === 2 &&
    PREVIEW_AUTH_EXEMPT_PATHS.includes(STRIPE_WEBHOOK_PATH) &&
    PREVIEW_AUTH_EXEMPT_PATHS.includes(CRON_BLOB_TTL_PATH),
  JSON.stringify(PREVIEW_AUTH_EXEMPT_PATHS),
);
check(
  "(d) echte Pfade sind /api/stripe-webhook und /api/cron/blob-ttl",
  STRIPE_WEBHOOK_PATH === "/api/stripe-webhook" && CRON_BLOB_TTL_PATH === "/api/cron/blob-ttl",
  `${STRIPE_WEBHOOK_PATH} | ${CRON_BLOB_TTL_PATH}`,
);
for (const path of [
  "/api/stripe-webhook",
  "/api/cron/blob-ttl",
  "/api/stripe-webhook?x=1",
  "/api/cron/blob-ttl/",
]) {
  const res = fakeRes();
  const blocked = applyPreviewBasicAuth({ headers: {}, url: path }, res, ENV_ON);
  check(
    `(d) ${path} ohne Credentials → durch (kein 401)`,
    blocked === false && res.ended === false && res.statusCode === 0,
    `blocked=${blocked} status=${res.statusCode}`,
  );
}
// Keine Über-Ausnahme: ähnliche Pfade bleiben geschützt.
for (const path of [
  "/api/stripe-webhook-extra",
  "/api/stripe-webhookx",
  "/api/cron/blob-ttl2",
  "/api/cron",
  "/api/images",
]) {
  check(`(d) kein Wildcard-Leak: ${path} bleibt geschützt`, isPreviewAuthExempt(path) === false);
}
check("(d) normalizePath entfernt Query", normalizePath("/api/cron/blob-ttl?a=b") === "/api/cron/blob-ttl");
check("(d) normalizePath entfernt Trailing-Slash", normalizePath("/app/") === "/app");

// ── (+) Konstantzeit-Vergleich ─────────────────────────────────────────────
check("(+) gleiche Strings → true", timingSafeStringEqual("abc", "abc") === true);
check("(+) leer vs leer → true", timingSafeStringEqual("", "") === true);
check("(+) leer vs gesetzt → false", timingSafeStringEqual("", "x") === false);
check("(+) gesetzt vs leer → false", timingSafeStringEqual("x", "") === false);
check("(+) unterschiedliche Länge → false", timingSafeStringEqual("abc", "abcd") === false);
check("(+) Präfix-Treffer → false", timingSafeStringEqual("demo", "demoX") === false);
check("(+) Umlaute exakt", timingSafeStringEqual("grüß", "grüß") === true);
check("(+) Umlaute abweichend", timingSafeStringEqual("grüß", "gruss") === false);

// Kein Kurzschluss: falscher User + richtiges Passwort wird genauso geprüft
// wie richtiger User + falsches Passwort (beides 401, beide Vergleiche laufen).
check(
  "(+) falscher User + richtiges Passwort → denied",
  decidePreviewAuth({ pathname: "/app", authorization: basic("nope", PASS), config: { user: USER, pass: PASS } }).kind === "denied",
);
check(
  "(+) richtiger User + falsches Passwort → denied",
  decidePreviewAuth({ pathname: "/app", authorization: basic(USER, "nope"), config: { user: USER, pass: PASS } }).kind === "denied",
);
check(
  "(+) richtige Credentials → allowed",
  decidePreviewAuth({ pathname: "/app", authorization: basic(USER, PASS), config: { user: USER, pass: PASS } }).kind === "allowed",
);
check(
  "(+) ohne Config → disabled (nicht denied)",
  decidePreviewAuth({ pathname: "/app", authorization: null, config: null }).kind === "disabled",
);
check(
  "(+) parseBasicCredentials ist case-insensitiv beim Schema",
  parseBasicCredentials(basic(USER, PASS).replace("Basic", "BASIC"))?.user === USER,
);
check(
  "(+) parseBasicCredentials: Passwort darf Doppelpunkte enthalten",
  parseBasicCredentials(basic(USER, "a:b:c"))?.pass === "a:b:c",
);
check("(+) parseBasicCredentials(null) === null", parseBasicCredentials(null) === null);

// ── (+) Verdrahtung im einzigen Function-Einstieg ──────────────────────────
const entry = readFileSync("./vercel-entry.ts", "utf8");
check(
  "(+) vercel-entry.ts importiert applyPreviewBasicAuth",
  /import\s*\{[^}]*applyPreviewBasicAuth[^}]*\}\s*from\s*"\.\/src\/lib\/preview-basic-auth"/.test(entry),
);
const gatePos = entry.indexOf("applyPreviewBasicAuth({ headers: req.headers, url: req.url }, res)");
check("(+) Gate wird im Handler aufgerufen", gatePos > 0);
check(
  "(+) Gate steht VOR dem Stripe-Webhook-Handler",
  gatePos > 0 && gatePos < entry.indexOf("handleStripeWebhookApi(webReq"),
  `gate=${gatePos} stripe=${entry.indexOf("handleStripeWebhookApi(webReq")}`,
);
check(
  "(+) Gate steht VOR dem SSR-FetchHandler",
  gatePos > 0 && gatePos < entry.indexOf("fetchHandler.fetch(webReq)"),
);
check(
  "(+) Gate steht VOR dem Generate-Stream-Handler",
  gatePos > 0 && gatePos < entry.indexOf("handleGenerateStreamApi(webReq"),
);
check(
  "(+) Gate antwortet mit return (kein Weiterlaufen nach 401)",
  /applyPreviewBasicAuth\(\{[^}]*\}, res\)\) \{\s*return;/.test(entry),
);
check(
  "(+) kein VITE_*-Leak der Zugangsdaten (nur process.env serverseitig)",
  !/VITE_PREVIEW_AUTH/.test(entry) && !/import\.meta\.env/.test(entry),
);
const mod = readFileSync("./src/lib/preview-basic-auth.ts", "utf8");
check(
  "(+) nutzt crypto.timingSafeEqual (kein ===-Vergleich der Secrets)",
  mod.includes("timingSafeEqual(") && mod.includes('from "node:crypto"'),
);
check(
  "(+) beide Vergleiche laufen immer (kein Kurzschluss im Code)",
  /const userOk = timingSafeStringEqual/.test(mod) &&
    /const passOk = timingSafeStringEqual/.test(mod) &&
    !/timingSafeStringEqual\([^)]*\)\s*&&\s*timingSafeStringEqual/.test(mod),
);
check(
  "(+) Modul liest nur process.env, keine VITE-Variablen",
  mod.includes("process.env") && !/VITE_PREVIEW_AUTH|import\.meta\.env/.test(mod),
);

// ── Ergebnis ───────────────────────────────────────────────────────────────
console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

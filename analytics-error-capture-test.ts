// ── Phase Analytics-Erweiterung: Fehleranalyse (Erfassung + Report) ──────────
// Run: bun --env-file=.env run ./analytics-error-capture-test.ts
// Deckt ab: Whitelist/Regex serverseitig (400 bei Verstoß), Kategorie nur bei
// status='error', KEINE Meldungen/Prompts/PII (400 + keine Zeile), Report zeigt
// ausschließlich Kanal/Zeit/Kategorie/Code, nicht erfasste Altfehler erscheinen
// als 'unknown' mit recorded=false, errorsByCategory/errorsTotal konsistent.
// Zusätzlich: deterministische Klassifizierung (Unit-Checks, kein LLM).
// @ts-nocheck — Testskript, nicht Teil des App-Bundles.
import { randomBytes } from "node:crypto";
process.env.ANALYTICS_SALT = randomBytes(32).toString("hex");
const { getDb } = await import("./src/db/index.ts");
const { handleAnalyticsApi } = await import("./src/api/analytics.ts");
const { qGetAdminAnalyticsReport } = await import("./src/db/admin-analytics.ts");
const { classifyGenerationError, isAnalyticsErrorCode, ANALYTICS_ERROR_CATEGORIES } = await import(
  "./src/lib/analytics-error.ts"
);

const MARK = "error-capture-test.invalid";
const PROMPT_MARKER = "PROMPT-GEHEIM-4711";
const EMAIL_MARKER = "leak@example.com";
const sql = getDb();

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
};

const PORT = 3463;
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const r = await handleAnalyticsApi(req, pathname);
    return r ?? new Response("not found", { status: 404 });
  },
});
const ENDPOINT = `http://127.0.0.1:${PORT}/api/analytics-events`;

const countRows = async () => {
  const r = await sql`SELECT COUNT(*) AS n FROM analytics_events WHERE referrer_host = ${MARK}`;
  return Number(r[0].n);
};

const post = async (body: Record<string, unknown>) => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.21" },
    body: JSON.stringify(body),
  });
  return res.status;
};

await sql`DELETE FROM analytics_events WHERE referrer_host = ${MARK}`;

// ── (1) Gültiger Fehler mit Kategorie + Code ────────────────────────────────
{
  const before = await countRows();
  const status = await post({
    event: "generation_finished",
    channel: "pinterest_pin",
    status: "error",
    durationMs: 1234,
    errorCategory: "timeout",
    errorCode: "client_timeout",
    referrerHost: MARK,
    metadata: { route: "/app/generate/pinterest" },
  });
  check("(1) gültige Felder → 202", status === 202, `got ${status}`);
  check("(1) genau eine Zeile geschrieben", (await countRows()) === before + 1);
  const rows = await sql`
    SELECT error_category, error_code, channel, status, duration_ms, metadata
    FROM analytics_events WHERE referrer_host = ${MARK} ORDER BY created_at DESC LIMIT 1
  `;
  check("(1) error_category gespeichert", rows[0]?.error_category === "timeout", String(rows[0]?.error_category));
  check("(1) error_code gespeichert", rows[0]?.error_code === "client_timeout", String(rows[0]?.error_code));
  check("(1) keine Meldung/Stacktrace-Spalte befüllt", rows[0]?.metadata && Object.keys(rows[0].metadata).length === 1);
}

// ── (2) Whitelist / Regex / Status-Gate (jeweils 400 + keine neue Zeile) ────
{
  const before = await countRows();
  const bad: [string, Record<string, unknown>][] = [
    ["unbekannte Kategorie", { event: "generation_finished", status: "error", errorCategory: "boom", referrerHost: MARK }],
    ["Code mit Leerzeichen", { event: "generation_finished", status: "error", errorCategory: "timeout", errorCode: "http 429", referrerHost: MARK }],
    ["Code mit Slash", { event: "generation_finished", status: "error", errorCategory: "timeout", errorCode: "http/429", referrerHost: MARK }],
    ["Code > 40 Zeichen", { event: "generation_finished", status: "error", errorCategory: "timeout", errorCode: "a".repeat(41), referrerHost: MARK }],
    ["Code in Großbuchstaben", { event: "generation_finished", status: "error", errorCategory: "timeout", errorCode: "HTTP_429", referrerHost: MARK }],
    ["Kategorie bei status=done", { event: "generation_finished", status: "done", errorCategory: "timeout", referrerHost: MARK }],
    ["Kategorie ohne status", { event: "generation_finished", errorCategory: "timeout", referrerHost: MARK }],
  ];
  let all400 = true;
  for (const [name, body] of bad) {
    const s = await post(body);
    if (s !== 400) {
      all400 = false;
      console.log(`  → ${name}: got ${s}`);
    }
  }
  check("(2) alle 7 ungültigen Varianten → 400", all400);
  check("(2) keine Zeile für ungültige Payloads", (await countRows()) === before, `before=${before} now=${await countRows()}`);
}

// ── (3) PII-/Inhalts-Probe: prompt/message/stack/email werden abgelehnt ─────
{
  const before = await countRows();
  const probes: [string, Record<string, unknown>][] = [
    ["prompt", { event: "generation_finished", status: "error", prompt: PROMPT_MARKER, referrerHost: MARK }],
    ["message", { event: "generation_finished", status: "error", message: PROMPT_MARKER, referrerHost: MARK }],
    ["content (verschachtelt)", { event: "generation_finished", status: "error", metadata: { content: PROMPT_MARKER }, referrerHost: MARK }],
    ["email", { event: "generation_finished", status: "error", email: EMAIL_MARKER, referrerHost: MARK }],
    ["text", { event: "generation_finished", status: "error", text: PROMPT_MARKER, referrerHost: MARK }],
  ];
  let all400 = true;
  for (const [name, body] of probes) {
    const s = await post(body);
    if (s !== 400) {
      all400 = false;
      console.log(`  → ${name}: got ${s}`);
    }
  }
  check("(3) alle PII-/Inhalts-Proben → 400", all400);
  check("(3) keine Zeile geschrieben", (await countRows()) === before);

  // Unbekannte, nicht gelistete Schlüssel (z. B. stack/error_detail) werden
  // nicht als Feld gespeichert: die Anfrage läuft durch, aber der Wert darf
  // nirgends in der DB landen (nur Whitelist-Felder werden gelesen).
  const unknownBefore = await countRows();
  const s = await post({
    event: "generation_finished",
    status: "error",
    stack: PROMPT_MARKER,
    error_message: PROMPT_MARKER,
    referrerHost: MARK,
  });
  check("(3) unbekannte Zusatzschlüssel werden nicht gespeichert", s === 202 && (await countRows()) === unknownBefore + 1, `status=${s}`);
  const stored = await sql`
    SELECT metadata::text AS meta, error_code, error_category, referrer_host
    FROM analytics_events WHERE referrer_host = ${MARK} ORDER BY created_at DESC LIMIT 1
  `;
  check("(3) kein Marker in der gespeicherten Zeile", !JSON.stringify(stored[0]).includes("GEHEIM"), JSON.stringify(stored[0]));
  const leak = await sql`
    SELECT COUNT(*) AS n FROM analytics_events
    WHERE referrer_host = ${MARK} AND (metadata::text LIKE '%GEHEIM%' OR error_code LIKE '%GEHEIM%' OR error_category LIKE '%GEHEIM%')
  `;
  check("(3) kein Prompt-Text in der DB", Number(leak[0].n) === 0);
}

// ── (4) Report: neue Sektion, Altfehler als 'unknown', keine Leaks ──────────
{
  // 2 klassifizierte Fehler + 1 Altfehler ohne Kategorie (wie die 4 Bestandsfehler)
  await post({ event: "generation_finished", channel: "seo_blog", status: "error", errorCategory: "rate_limit", errorCode: "http_429", referrerHost: MARK });
  await post({ event: "generation_finished", channel: "image", status: "error", errorCategory: "aborted", errorCode: "user_abort", referrerHost: MARK });
  await sql`
    INSERT INTO analytics_events (user_pseudonym, event, channel, status, duration_ms, referrer_host, metadata)
    VALUES (NULL, 'generation_finished', 'pinterest_pin', 'error', 2392, ${MARK}, '{"route":"/app/generate/pinterest"}')
  `;

  const report = await qGetAdminAnalyticsReport(30, 0);
  check("(4) errorEvents vorhanden (max. 100)", Array.isArray(report.errorEvents) && report.errorEvents.length <= 100);
  check("(4) errorEvents enthält NUR Kanal/Zeit/Kategorie/Code/recorded", report.errorEvents.every((e) => {
    const keys = Object.keys(e).sort().join(",");
    return keys === "at,category,channel,code,recorded";
  }), JSON.stringify(Object.keys(report.errorEvents[0] ?? {})));
  // Die drei gerade geschriebenen Fehler sind die NEUESTEN (ORDER BY created_at DESC).
  const newest = report.errorEvents.slice(0, 3);
  const legacy = newest.find((e) => e.channel === "pinterest_pin");
  const rate = newest.find((e) => e.channel === "seo_blog");
  const aborted = newest.find((e) => e.channel === "image");
  check("(4) die 3 neuen Zeilen sind die neuesten im Report", Boolean(legacy && rate && aborted), JSON.stringify(newest.map((e) => `${e.channel}/${e.category}/${e.code}`)));
  check("(4) Altfehler ohne Kategorie → 'unknown'", legacy?.category === "unknown", String(legacy?.category));
  check("(4) Altfehler recorded=false (keine Ursache erfasst, kein Raten)", legacy?.recorded === false);
  check("(4) erfasster Fehler recorded=true + Code", rate?.recorded === true && rate?.code === "http_429", JSON.stringify(rate));
  check("(4) Abbruch wird als 'aborted' geführt (kein Defekt)", aborted?.category === "aborted" && aborted?.recorded === true, JSON.stringify(aborted));
  check("(4) Zeitstempel der neuen Zeilen ist ISO", newest.every((e) => !Number.isNaN(Date.parse(e.at))));
  check("(4) errorDataSince gesetzt (ISO)", typeof report.errorDataSince === "string" && !Number.isNaN(Date.parse(report.errorDataSince)), String(report.errorDataSince));
  const sum = report.errorsByCategory.reduce((n, c) => n + c.count, 0);
  check("(4) errorsByCategory summiert == errorsTotal", sum === report.errorsTotal, `sum=${sum} total=${report.errorsTotal}`);
  check("(4) unknown ist als Kategorie enthalten", report.errorsByCategory.some((c) => c.category === "unknown" && c.count > 0));
  const body = JSON.stringify(report);
  check("(4) kein Prompt/keine E-Mail im Report-Body", !body.includes(PROMPT_MARKER) && !body.includes(EMAIL_MARKER));
  check("(4) kein Pseudonym/Rohzeilen-Schlüssel im Body", !/"user_pseudonym"|"visitor_key"|"user_id"/.test(body));
  check("(4) Bestandsfeld generationByChannel unverändert vorhanden", Array.isArray(report.generationByChannel)
    && report.generationByChannel.every((g) => ["channel", "started", "done", "errors", "avgMs", "medianMs"].every((k) => k in g)));
  check("(4) Bestandsfelder unverändert vorhanden", ["views", "uniquePseudonyms", "anonymousViews", "viewsToday", "registrations", "activeUsers"].every((k) => k in report.kpi));

  // Fenster „today" lädt die markierten (gerade eingefügten) Fehler ebenfalls
  const today = await qGetAdminAnalyticsReport(0, 0);
  check("(4) today-Fenster: Trend 1 Tag + Fehler des Tages enthalten", today.trend.length === 1 && today.errorEvents.some((e) => e.category === "rate_limit"));
}

// ── (5) Klassifizierung: deterministisch, nur Whitelist-Werte ───────────────
{
  const cases: [string, unknown, ("user" | "timeout" | null)?, string, string][] = [
    ["Guard-Timeout", new Error("irrelevant"), "timeout", "timeout", "client_timeout"],
    ["Guard-Abbruch", new Error("irrelevant"), "user", "aborted", "user_abort"],
    ["Kontingent (UsageLimitError-Form)", { name: "UsageLimitError", code: "USAGE_LIMIT", message: "Limit erreicht" }, null, "quota", "usage_limit"],
    ["Rate-Drossel (RateLimitError-Form)", { name: "RateLimitError", code: "RATE_LIMIT", message: "zu schnell" }, null, "rate_limit", "rate_limit"],
    ["HTTP 429", new Error("Generation failed: 429 Too Many Requests"), null, "rate_limit", "http_429"],
    ["HTTP 500", new Error("Server error 500"), null, "server", "http_500"],
    ["HTTP 403", new Error("Forbidden 403"), null, "provider", "http_403"],
    ["Netzwerk", new Error("fetch failed"), null, "network", "network_error"],
    ["Validierung (ServerFn-Detail)", { data: { message: "x" } }, null, "validation", "invalid_input"],
    ["Unbekannt", new Error("völlig anderes Problem"), null, "unknown", "unknown"],
  ];
  let ok = true;
  for (const [name, err, reason, cat, code] of cases) {
    const cls = classifyGenerationError(err, reason ?? null);
    if (cls.category !== cat || cls.code !== code) {
      ok = false;
      console.log(`  → ${name}: ${JSON.stringify(cls)} statt ${cat}/${code}`);
    }
  }
  check("(5) 10 Klassifizierungsfälle exakt", ok);
  check("(5) Whitelist vollständig verdrahtet", ANALYTICS_ERROR_CATEGORIES.length === 9 && ANALYTICS_ERROR_CATEGORIES.includes("unknown"));
  check("(5) Code-Regex hält Beispiele", isAnalyticsErrorCode("http_429") && isAnalyticsErrorCode("client_timeout") && !isAnalyticsErrorCode("http 429") && !isAnalyticsErrorCode("HTTP_429"));
}

await sql`DELETE FROM analytics_events WHERE referrer_host = ${MARK}`;
const left = await sql`SELECT COUNT(*) AS n FROM analytics_events WHERE referrer_host = ${MARK}`;
check("(6) Cleanup: Testzeilen entfernt", Number(left[0].n) === 0);
server.stop();
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);

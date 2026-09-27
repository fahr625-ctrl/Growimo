// ── Phase Analytics-Erweiterung: Unique Visitors (DISTINCT je Zeitraum) ──────
// Run: bun --env-file=.env run ./analytics-unique-visitors-test.ts
// Deckt ab: Δ-Exaktheit von COUNT(DISTINCT visitor_key) je Fenster, Dedupe
// innerhalb eines Zeitraums, kein Backfill (visitor_key NULL zählt nicht),
// visitor_new, visitorsSince, Range "today" (Kalendertag, Trend 1 Tag),
// Label-Klärung „Anonyme Seitenaufrufe (ohne Login)" bei identischer Zahl,
// und dass KEINE bestehende Kennzahl sich verschiebt.
// Seeds sind mit referrer_host = 'uv-test.invalid' markiert und werden am Ende
// entfernt (die Testlaufzeit nutzt die echte Neon-DB → nur Deltas sind gültig).
// @ts-nocheck — Testskript, nicht Teil des App-Bundles.
import { randomBytes, randomUUID } from "node:crypto";
process.env.ANALYTICS_SALT = randomBytes(32).toString("hex");
const SALT = process.env.ANALYTICS_SALT as string;
const { getDb } = await import("./src/db/index.ts");
const { qInsertAnalyticsEvent } = await import("./src/db/analytics.ts");
const { qGetAdminAnalyticsReport } = await import("./src/db/admin-analytics.ts");
const { createHmac } = await import("node:crypto");
const de = (await import("./src/i18n/de.ts")).de;
const en = (await import("./src/i18n/en.ts")).en;
const sql = getDb();
const MARK = "uv-test.invalid";
const pseudo = (id: string) => createHmac("sha256", SALT).update(id).digest("hex");
const hex32 = () => randomUUID().replace(/-/g, "");

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

const report = (rangeDays: number | null) => qGetAdminAnalyticsReport(rangeDays, 0);

await sql`DELETE FROM analytics_events WHERE referrer_host = ${MARK}`;

const before = await report(30);
const beforeToday = await report(0);

// ── Seed ─────────────────────────────────────────────────────────────────────
const OWNER_PSEUDO = pseudo("test_uv_owner_pseudo"); // = „eingeloggter" Besucher
const KEY_A = hex32();
const KEY_B = hex32();
const seed = async () => {
  // 2 Anonyme mit Zustimmung: je 3 Pageviews (erstmaliger Schlüssel -> new)
  for (const key of [KEY_A, KEY_B]) {
    for (let i = 0; i < 3; i++) {
      await qInsertAnalyticsEvent({
        userPseudonym: null,
        event: "pageview",
        referrerHost: MARK,
        visitorKey: key,
        visitorNew: i === 0,
      });
    }
  }
  // 1 eingeloggter Besucher: 2 Pageviews (Schlüssel = HMAC-Pseudonym)
  for (let i = 0; i < 2; i++) {
    await qInsertAnalyticsEvent({
      userPseudonym: OWNER_PSEUDO,
      event: "pageview",
      referrerHost: MARK,
      visitorKey: OWNER_PSEUDO,
      visitorNew: false,
    });
  }
  // Altbestand: Pageview ohne Kennung (darf Unique Visitors NICHT erhöhen)
  await qInsertAnalyticsEvent({
    userPseudonym: null,
    event: "pageview",
    referrerHost: MARK,
    visitorKey: null,
    visitorNew: null,
  });
};
await seed();

const after = await report(30);
const afterToday = await report(0);
const D = (a: number, b: number) => a - b;
const K = (r: any, k: string) => Number(r.kpi[k] ?? 0);

// (1) Fenster 30 Tage: 3 eindeutige Schlüssel, 9 Pageviews
check("(1) Δviews(30d)=+9", D(K(after, "views"), K(before, "views")) === 9, JSON.stringify(after.kpi));
check("(1) ΔuniqueVisitors(30d)=+3 (2 Anonyme + 1 Eingeloggter)", D(K(after, "uniqueVisitors"), K(before, "uniqueVisitors")) === 3);
check("(1) ΔnewVisitors(30d)=+2 (nur erstmalige Schlüssel)", D(K(after, "newVisitors"), K(before, "newVisitors")) === 2);
check("(1) ΔanonymousViews(30d)=+7 (6 mit Kennung + 1 Altbestand ohne)", D(K(after, "anonymousViews"), K(before, "anonymousViews")) === 7);
check("(1) ΔuniquePseudonyms(30d)=+1 (bestehende Kennzahl unverändert definiert)", D(K(after, "uniquePseudonyms"), K(before, "uniquePseudonyms")) === 1);

// (2) Fenster „today" (Kalendertag) — Seeds liegen in „jetzt"
check("(2) heute: ΔuniqueVisitors=+3", D(K(afterToday, "uniqueVisitors"), K(beforeToday, "uniqueVisitors")) === 3);
check("(2) heute: Δviews=+9", D(K(afterToday, "views"), K(beforeToday, "views")) === 9);
check("(2) heute: viewsToday == views (gleiche Kalendertag-Definition)", afterToday.kpi.viewsToday === afterToday.kpi.views);
check("(2) heute: Trend hat genau 1 Tag", Array.isArray(afterToday.trend) && afterToday.trend.length === 1, `len=${afterToday.trend?.length}`);
check("(2) 30d: Trend hat 30 Tage (unverändert)", after.trend.length === 30);
check("(2) 7d/90d/all weiter gültig", (await report(7)).rangeDays === 7 && (await report(90)).rangeDays === 90 && (await report(null)).rangeDays === null);

// (3) Dedupe: ein weiterer Pageview desselben Schlüssels erhöht views, nicht uniqueVisitors
await qInsertAnalyticsEvent({ userPseudonym: null, event: "pageview", referrerHost: MARK, visitorKey: KEY_A, visitorNew: false });
const after2 = await report(30);
check("(3) Δviews=+10, ΔuniqueVisitors bleibt +3", D(K(after2, "views"), K(before, "views")) === 10 && D(K(after2, "uniqueVisitors"), K(before, "uniqueVisitors")) === 3, JSON.stringify(after2.kpi));

// (4) kein Backfill: Altbestand (visitor_key NULL) niemals in Unique Visitors
const legacy = await sql`
  SELECT COUNT(DISTINCT visitor_key) AS n FROM analytics_events
  WHERE referrer_host = ${MARK} AND visitor_key IS NULL
`;
check("(4) Altzzeile hat visitor_key NULL (kein Backfill)", Number(legacy[0].n) === 0);
const distinctKeys = await sql`
  SELECT COUNT(DISTINCT visitor_key) AS n FROM analytics_events WHERE referrer_host = ${MARK}
`;
check("(4) DISTINCT der markierten Zeilen = 3", Number(distinctKeys[0].n) === 3, `n=${distinctKeys[0].n}`);

// (5) visitorsSince: gesetzt und plausibel (ISO, nicht in der Zukunft)
const since = after2.visitorsSince;
check("(5) visitorsSince gesetzt (ISO)", typeof since === "string" && !Number.isNaN(Date.parse(since)), String(since));
check("(5) visitorsSince liegt nicht in der Zukunft", typeof since === "string" && Date.parse(since) <= Date.now() + 1000);

// (6) Regression: keine anderen Kennzahlen/Fenster verändert sich durch die Seeds
const chanDelta = (ch: string) => {
  const a = after2.generationByChannel.find((g: any) => g.channel === ch) ?? {};
  const b = before.generationByChannel.find((g: any) => g.channel === ch) ?? {};
  return (Number(a.started ?? 0) - Number(b.started ?? 0)) + (Number(a.done ?? 0) - Number(b.done ?? 0)) + (Number(a.errors ?? 0) - Number(b.errors ?? 0));
};
check("(6) ΔgenerationByChannel über alle Kanäle = 0 (Seeds sind reine Pageviews)", after2.generationByChannel.every((g: any) => chanDelta(g.channel) === 0));
check("(6) ΔerrorsTotal = 0 (kein Fehler geseedet)", after2.errorsTotal - before.errorsTotal === 0, `Δ=${after2.errorsTotal - before.errorsTotal}`);
const upfDelta = (fn: string) => {
  const a = after2.usersPerFunction.find((u: any) => u.function === fn)?.users ?? 0;
  const b = before.usersPerFunction.find((u: any) => u.function === fn)?.users ?? 0;
  return a - b;
};
check("(6) ΔusersPerFunction(alle) = 0", after2.usersPerFunction.every((u: any) => upfDelta(u.function) === 0));
check("(6) Δregistrations/activeUsers = 0", D(K(after2, "registrations"), K(before, "registrations")) === 0 && D(K(after2, "activeUsers"), K(before, "activeUsers")) === 0);

// (7) Label-Klärung: gleiche Zahl, eindeutige Bezeichnung (i18n, de+en)
check("(7) de: analytics_kpi_anon = 'Anonyme Seitenaufrufe (ohne Login)'", de.analytics_kpi_anon === "Anonyme Seitenaufrufe (ohne Login)", de.analytics_kpi_anon);
check("(7) en: analytics_kpi_anon nennt page views (logged out)", en.analytics_kpi_anon === "Anonymous page views (logged out)", en.analytics_kpi_anon);
check("(7) neue Keys in beiden Sprachen vorhanden", ["analytics_range_today", "analytics_kpi_unique_visitors", "analytics_unique_visitors_note", "analytics_unique_no_data"].every((k) => k in de && k in en));
check("(7) de/en Parität (gleiche Key-Anzahl)", Object.keys(de).length === Object.keys(en).length, `de=${Object.keys(de).length} en=${Object.keys(en).length}`);
check("(7) bestehende Kennzahl-Labels unverändert", de.analytics_kpi_views === "Besuche gesamt" && de.analytics_kpi_unique === "Eingeloggte Besucher" && de.analytics_kpi_today === "Besuche heute");

// ── Cleanup ──────────────────────────────────────────────────────────────────
await sql`DELETE FROM analytics_events WHERE referrer_host = ${MARK}`;
const left = await sql`SELECT COUNT(*) AS n FROM analytics_events WHERE referrer_host = ${MARK}`;
check("(8) Cleanup: Seed-Zeilen entfernt", Number(left[0].n) === 0);

console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);

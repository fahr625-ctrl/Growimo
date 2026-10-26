// ── Route-Gate der Rechtstexte — Test (Stand 2026-10-26, Launch-Vorlauf Teil 1) ─
// Lauf: bun run legal-route-gate-test.ts
//
// NEUE Erwartung (Owner-Freigabe 2026-10-26): Das Prod-404-Gate ist AUS.
// /impressum, /agb, /widerruf und /datenschutz sind in JEDER Umgebung
// öffentlich erreichbar (200) — Production, Preview, lokal, Tests.
// Es wird kein `x-robots-tag: noindex` und kein 404-Body mehr erzeugt.
import {
  ALWAYS_PUBLIC_LEGAL_PATHS,
  PROD_404_LEGAL_PATHS,
  applyLegalRouteGate,
  decideLegalRouteGate,
  isProductionDeployment,
  normalizeGatePath,
  type GateRequest,
  type GateResponse,
} from "./src/lib/legal-route-gate";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  checks++;
  if (cond) {
    console.log("PASS:", name);
  } else {
    failures++;
    console.log("FAIL:", name, detail ? `— ${detail}` : "");
  }
}

const PROD_ENV = { VERCEL_ENV: "production" };
const PREVIEW_ENV = { VERCEL_ENV: "preview" };
const DEV_ENV = { VERCEL_ENV: "development" };
const LOCAL_ENV = {} as Record<string, string | undefined>;
const LEGAL_PATHS = ["/impressum", "/agb", "/widerruf", "/datenschutz"];

// ── (1) Die 404-Liste ist leer — keine Route wird in Prod versteckt ──────────
check("PROD_404_LEGAL_PATHS ist leer", PROD_404_LEGAL_PATHS.length === 0, String(PROD_404_LEGAL_PATHS));
check(
  "keine der vier Rechtsseiten ist als Prod-404 markiert",
  LEGAL_PATHS.every((p) => !PROD_404_LEGAL_PATHS.includes(p)),
);
check("/datenschutz bleibt immer öffentlich", ALWAYS_PUBLIC_LEGAL_PATHS.includes("/datenschutz"));

// ── (2) Umgebungserkennung bleibt unverändert ──────────────────────────────
check("isProductionDeployment(production) === true", isProductionDeployment(PROD_ENV));
check("isProductionDeployment(preview) === false", !isProductionDeployment(PREVIEW_ENV));
check("isProductionDeployment(development) === false", !isProductionDeployment(DEV_ENV));
check("isProductionDeployment(lokal) === false", !isProductionDeployment(LOCAL_ENV));

// ── (3) Alle vier Seiten → serve (200) in JEDER Umgebung ────────────────────
for (const [label, env] of [
  ["Production", PROD_ENV],
  ["Preview", PREVIEW_ENV],
  ["Development", DEV_ENV],
  ["Lokal", LOCAL_ENV],
] as Array<[string, Record<string, string | undefined>]>) {
  for (const p of LEGAL_PATHS) {
    const d = decideLegalRouteGate({ pathname: p, env });
    check(`${label}: ${p} → serve (200)`, d.kind === "serve", d.kind);
  }
}

// ── (4) Pfad-Varianten: Trailing-Slash, Query, Groß-/Kleinschreibung ───────
check("normalizeGatePath('/impressum/') === '/impressum'", normalizeGatePath("/impressum/") === "/impressum");
check("normalizeGatePath('/agb?x=1') === '/agb'", normalizeGatePath("/agb?x=1") === "/agb");
check("normalizeGatePath('/Widerruf') === '/widerruf'", normalizeGatePath("/Widerruf") === "/widerruf");
for (const variant of ["/impressum/", "/agb?utm=1", "/WIDERRUF", "/impressum/foo", "/datenschutz/"]) {
  const d = decideLegalRouteGate({ pathname: variant, env: PROD_ENV });
  check(`Prod: ${variant} → serve (200)`, d.kind === "serve", d.kind);
}

// ── (5) applyLegalRouteGate beantwortet NICHTS mehr (kein 404, kein noindex) ─
for (const [label, env] of [
  ["Production", PROD_ENV],
  ["Preview", PREVIEW_ENV],
  ["Lokal", LOCAL_ENV],
] as Array<[string, Record<string, string | undefined>]>) {
  for (const p of LEGAL_PATHS) {
    const state = { statusCode: 0, ended: false, headers: [] as string[] };
    const res: GateResponse = {
      set statusCode(v: number) {
        state.statusCode = v;
      },
      get statusCode() {
        return state.statusCode;
      },
      setHeader(name: string) {
        state.headers.push(name.toLowerCase());
        return undefined;
      },
      end() {
        state.ended = true;
        return undefined;
      },
    };
    const req: GateRequest = { headers: {}, url: p };
    const handled = applyLegalRouteGate(req, res, env);
    check(`${label} ${p}: handled === false (kein 404)`, handled === false);
    check(`${label} ${p}: kein res.end()`, state.ended === false);
    check(`${label} ${p}: Status nicht 404`, state.statusCode !== 404, String(state.statusCode));
    check(
      `${label} ${p}: KEIN x-robots-tag/noindex-Header`,
      !state.headers.some((h) => h === "x-robots-tag" || h.includes("noindex")),
      state.headers.join(","),
    );
  }
}

console.log(`\n${checks - failures}/${checks} Prüfungen grün, ${failures} rot.`);
if (failures > 0) process.exit(1);

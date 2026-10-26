// ── Route-Gate der Rechtstexte (Prod 404 / sonst 200) ────────────────────────
// Lauf: bun run legal-route-gate-test.ts
//
// Owner-Freigabe 2026-10-26: Auf www.growimo.app (Production) dürfen NUR die
// korrigierte Datenschutzerklärung öffentlich sein. /impressum, /agb und
// /widerruf warten auf das finale Owner-Gegenlesen → dort echter 404.
// In Preview (preview.growimo.app), lokal und in Tests bleiben alle VIER
// Routen erreichbar (Owner-Gegenlesen in der Vorschau).
//
// Geprüft wird:
//   (1) Production-Simulation: 3 Routen → 404, /datenschutz → 200 (durch)
//   (2) Nicht-Production (preview/development/unset): alle 4 Routen → durch
//   (3) Pfad-Normalisierung: Trailing-Slash, Query, Groß-/Kleinschreibung
//   (4) applyLegalRouteGate: exakter Status, Header, kein Weiterlaufen
//   (5) Verdrahtung in vercel-entry.ts (VOR SSR/Handlern) + importfreies Modul
import { readFileSync } from "node:fs";

import {
  ALWAYS_PUBLIC_LEGAL_PATHS,
  PROD_404_LEGAL_PATHS,
  applyLegalRouteGate,
  decideLegalRouteGate,
  isProductionDeployment,
  normalizeGatePath,
} from "./src/lib/legal-route-gate";

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

const PROD_ENV = { VERCEL_ENV: "production" } as Record<string, string | undefined>;
const PREVIEW_ENV = { VERCEL_ENV: "preview" } as Record<string, string | undefined>;
const DEV_ENV = { VERCEL_ENV: "development" } as Record<string, string | undefined>;
const LOCAL_ENV = {} as Record<string, string | undefined>;

// Minimal-Fakes: bilden nur das nach, was das Gate benutzt.
function fakeRes() {
  const headers: Record<string, string> = {};
  const state = { statusCode: 200, body: undefined as string | undefined, ended: false };
  return {
    state,
    headers,
    res: {
      get statusCode() {
        return state.statusCode;
      },
      set statusCode(v: number) {
        state.statusCode = v;
      },
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return undefined;
      },
      end(body?: string) {
        state.ended = true;
        state.body = body;
        return undefined;
      },
    },
  };
}

// ── (1) Production: 3 Routen 404, /datenschutz 200 ──────────────────────────
console.log("\n[1] Production-Simulation (VERCEL_ENV=production)");
check("isProductionDeployment(production) === true", isProductionDeployment(PROD_ENV));
check(
  "3 Routen sind als Prod-404 markiert",
  PROD_404_LEGAL_PATHS.length === 3 &&
    ["/impressum", "/agb", "/widerruf"].every((p) => PROD_404_LEGAL_PATHS.includes(p)),
);
check(
  "/datenschutz ist NICHT in der 404-Liste",
  !PROD_404_LEGAL_PATHS.includes("/datenschutz"),
);
for (const p of ["/impressum", "/agb", "/widerruf"]) {
  const d = decideLegalRouteGate({ pathname: p, env: PROD_ENV });
  check(`Prod: ${p} → not-found`, d.kind === "not-found", d.kind);
}
const dsProd = decideLegalRouteGate({ pathname: "/datenschutz", env: PROD_ENV });
check("Prod: /datenschutz → serve (200)", dsProd.kind === "serve", dsProd.kind);
for (const p of ["/", "/app", "/app/pricing", "/api/tracking"]) {
  const d = decideLegalRouteGate({ pathname: p, env: PROD_ENV });
  check(`Prod: ${p} bleibt unberührt`, d.kind === "serve", d.kind);
}

// ── (2) Nicht-Production: alle 4 Routen 200 ─────────────────────────────────
console.log("\n[2] Nicht-Production (Preview / local / Tests)");
for (const [label, env] of [
  ["preview", PREVIEW_ENV],
  ["development", DEV_ENV],
  ["unset", LOCAL_ENV],
] as const) {
  check(`isProductionDeployment(${label}) === false`, !isProductionDeployment(env));
  for (const p of ["/impressum", "/datenschutz", "/agb", "/widerruf"]) {
    const d = decideLegalRouteGate({ pathname: p, env });
    check(`${label}: ${p} → serve (200)`, d.kind === "serve", d.kind);
  }
}

// ── (3) Pfad-Normalisierung ─────────────────────────────────────────────────
console.log("\n[3] Pfad-Normalisierung");
check("normalizeGatePath('/impressum/') === '/impressum'", normalizeGatePath("/impressum/") === "/impressum");
check("normalizeGatePath('/agb?x=1') === '/agb'", normalizeGatePath("/agb?x=1") === "/agb");
check("normalizeGatePath('/Widerruf') === '/widerruf'", normalizeGatePath("/Widerruf") === "/widerruf");
check(
  "Prod: /impressum/ → 404 (Trailing-Slash)",
  decideLegalRouteGate({ pathname: "/impressum/", env: PROD_ENV }).kind === "not-found",
);
check(
  "Prod: /agb?utm=1 → 404 (Query)",
  decideLegalRouteGate({ pathname: "/agb?utm=1", env: PROD_ENV }).kind === "not-found",
);
check(
  "Prod: /WIDERRUF → 404 (Großschreibung)",
  decideLegalRouteGate({ pathname: "/WIDERRUF", env: PROD_ENV }).kind === "not-found",
);
check(
  "Prod: /impressum/foo → 404 (Unterpfad)",
  decideLegalRouteGate({ pathname: "/impressum/foo", env: PROD_ENV }).kind === "not-found",
);
check(
  "Prod: /datenschutz-alt → serve (kein Prefix-Missbrauch der Freigabe)",
  decideLegalRouteGate({ pathname: "/datenschutz-alt", env: PROD_ENV }).kind === "serve",
);
check(
  "/datenschutz steht auf der Immer-öffentlich-Liste",
  ALWAYS_PUBLIC_LEGAL_PATHS.includes("/datenschutz"),
);

// ── (4) applyLegalRouteGate: Status/Header/Rückgabe ─────────────────────────
console.log("\n[4] applyLegalRouteGate (Antwort schreiben)");
{
  const { res, state, headers } = fakeRes();
  const handled = applyLegalRouteGate({ headers: {}, url: "/impressum" }, res, PROD_ENV);
  check("Prod /impressum: handled === true", handled === true);
  check("Prod /impressum: statusCode 404", state.statusCode === 404, String(state.statusCode));
  check("Prod /impressum: res.end() wurde aufgerufen", state.ended === true);
  check(
    "Prod /impressum: content-type text/html",
    (headers["content-type"] ?? "").startsWith("text/html"),
    headers["content-type"],
  );
  check("Prod /impressum: cache-control no-store", headers["cache-control"] === "no-store");
  check("Prod /impressum: x-robots-tag noindex", headers["x-robots-tag"] === "noindex");
  check(
    "Prod /impressum: Body nennt 404, keine Rechtsinhalte",
    (state.body ?? "").includes("404") && !(state.body ?? "").includes("DDG"),
  );
}
{
  const { res, state, headers } = fakeRes();
  const handled = applyLegalRouteGate({ headers: {}, url: "/datenschutz" }, res, PROD_ENV);
  check("Prod /datenschutz: handled === false (läuft weiter)", handled === false);
  check("Prod /datenschutz: kein Status-Eingriff", state.statusCode === 200);
  check("Prod /datenschutz: kein res.end()", state.ended === false);
  check("Prod /datenschutz: KEINE Header gesetzt", Object.keys(headers).length === 0);
}
for (const p of ["/impressum", "/agb", "/widerruf", "/datenschutz"]) {
  const { res, state } = fakeRes();
  const handled = applyLegalRouteGate({ headers: {}, url: p }, res, PREVIEW_ENV);
  check(
    `Preview ${p}: handled === false, Status unverändert 200`,
    handled === false && state.statusCode === 200 && state.ended === false,
  );
}

// ── (5) Verdrahtung + Modul-Vertrag ─────────────────────────────────────────
console.log("\n[5] Verdrahtung in vercel-entry.ts / Modul-Vertrag");
const entry = readFileSync("./vercel-entry.ts", "utf8");
check("vercel-entry importiert applyLegalRouteGate", entry.includes("applyLegalRouteGate"));
check(
  "vercel-entry ruft applyLegalRouteGate VOR dem SSR-Handler auf",
  entry.indexOf("applyLegalRouteGate({") > 0 &&
    entry.indexOf("applyLegalRouteGate({") < entry.indexOf("fetchHandler.fetch(webReq)"),
);
check(
  "vercel-entry: Gate liegt NACH dem Preview-Basic-Auth",
  entry.indexOf("applyPreviewBasicAuth({") < entry.indexOf("applyLegalRouteGate({"),
);
const mod = readFileSync("./src/lib/legal-route-gate.ts", "utf8");
check(
  "Modul hat keine Importe (reine Pfad/Env-Entscheidung)",
  !/^\s*import\s/m.test(mod),
);
check(
  "Modul liest nur VERCEL_ENV, keine VITE-Variable",
  mod.includes("VERCEL_ENV") && !/VITE_|import\.meta\.env/.test(mod),
);
check(
  "Modul enthält keinen DB-/Stripe-Aufruf",
  !/\bsql`|getDb\(|stripe/i.test(mod),
);
check(
  "Gate-Liste enthält keine Datenpfade",
  PROD_404_LEGAL_PATHS.every((p) => p.startsWith("/") && !p.startsWith("/api")),
);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

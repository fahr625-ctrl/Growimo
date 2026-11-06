/**
 * B2-DB-SUITE (2026-11-06) — Demo-DB-Env-Generator.
 *
 * Schreibt eine MINIMALE env-Datei, die nur DATABASE_URL mit dem Ziel
 * `growimo_demo` enthaelt (chmod 600). Damit laeuft die Suite gegen die Demo-DB,
 * ohne dass ein Secret in der Shell/Evidenz auftaucht.
 *
 * Aufruf: bun --env-file=.env run scripts/_b2-demo-env.ts /tmp/b2/demo.env
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEMO_DB_NAME = "growimo_demo";
const out = process.argv[2];
if (!out) throw new Error("usage: _b2-demo-env.ts <ziel-datei>");

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL not set (run with: bun --env-file=.env run ...)");
const demo = raw.replace(/\/neondb(\?|$)/, `/${DEMO_DB_NAME}$1`);
if (!new RegExp(`/${DEMO_DB_NAME}(\\?|$)`).test(demo)) {
  throw new Error(`refusing to write: URL does not point at ${DEMO_DB_NAME}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `DATABASE_URL=${demo}\n`, { mode: 0o600 });
chmodSync(out, 0o600);
console.log("geschrieben:", out, "(chmod 600)");
console.log("Ziel-DB-Name:", new URL(demo).pathname);
console.log("Host        :", new URL(demo).hostname);

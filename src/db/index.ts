import { neon } from "@neondatabase/serverless";
import { guardTestClient } from "./test-guard";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect a database before running queries.",
    );
  }
  // TEST-SUITE-PROD-GUARD (Owner-Auftrag 2026-10-25): In Test-Prozessen
  // (Einstiegsskript `*-test.ts`) liefert guardTestClient() einen Wrapper, der
  // jedes Schreib-Statement auf der PROD-DB VOR dem Absenden mit exit 1
  // abbricht (fail-closed). Ausserhalb von Test-Prozessen ist der Rückgabewert
  // unverändert der rohe Neon-Client — Produktionsverhalten identisch.
  // Details/Bedienung: src/db/test-guard.ts, Doku: PROD-GUARD.md im Team-Ordner.
  return guardTestClient(neon(url), url);
}

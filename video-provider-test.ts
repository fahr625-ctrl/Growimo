// ─────────────────────────────────────────────────────────────────────────────
// VIDEO-TESTUMGEBUNG (2026-11-06) — Anbieter-Vertrag über den Fake + Beweis,
// dass der Kling-Adapter ohne Flag/Key HART abgeschaltet ist (kein Netz).
// ─────────────────────────────────────────────────────────────────────────────
//   bun video-provider-test.ts
//
// Netz-Beweis: `globalThis.fetch` wird vor dem ersten Aufruf durch einen
// Wächter ersetzt, der JEDEN Zugriff zählt (und wirft). Am Ende muss der Zähler
// für den Fake-Pfad exakt 0 sein — „kein Netz" ist damit gemessen, nicht behauptet.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { FakeVideoProvider, buildFakeMp4 } from "./src/ai/video/fake-provider";
import { createKlingFalProvider, klingFalEnabled, klingFalDisabledReason } from "./src/ai/video/kling-fal";
import { KNOWN_VIDEO_PROVIDER_IDS, resolveVideoProvider, validateClipRequest } from "./src/ai/video/registry";
import {
  InvalidVideoRequestError,
  UnknownVideoProviderError,
  VideoCapabilityError,
  VideoProviderDisabledError,
  type VideoClipRequest,
} from "./src/ai/video/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    fail += 1;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}

async function throwsCode(name: string, fn: () => Promise<unknown> | unknown, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, "es wurde NICHT geworfen");
  } catch (err) {
    const actual = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined;
    check(name, actual === code, `Code ${String(actual)} statt ${code} (${(err as Error).message})`);
  }
}

// ── Netz-Wächter installieren, BEVOR irgendetwas gebaut wird ────────────────
const realFetch = globalThis.fetch;
let networkCalls = 0;
const networkUrls: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  networkCalls += 1;
  networkUrls.push(String(input));
  throw new Error(`NETZWERK-SPERRE im Test: ${String(input)}`);
}) as typeof fetch;

/** Ein Ersatz-fetch, der NUR für den Struktur-Nachweis des Kling-Adapters dient. */
function stubFetch(responses: { json?: unknown; bytes?: Uint8Array; ok?: boolean; status?: number }): typeof fetch {
  let call = 0;
  return (async () => {
    call += 1;
    const spec = responses;
    return {
      ok: spec.ok ?? true,
      status: spec.status ?? 200,
      headers: { get: () => "video/mp4" },
      json: async () => spec.json ?? {},
      arrayBuffer: async () => (spec.bytes ?? new Uint8Array([1, 2, 3])).buffer,
    } as unknown as Response;
  }) as typeof fetch;
}

function request(overrides: Partial<VideoClipRequest> = {}): VideoClipRequest {
  return {
    prompt: "photorealistic cinematic footage\nEine Frau gießt eine Tasse Kaffee ein",
    durationSeconds: 8,
    resolution: "720p",
    audio: false,
    multiShot: false,
    externalTaskId: "clip-0001",
    ...overrides,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

console.log("— video-provider-test (UMSETZUNGSPLAN §2) —\n");

// ── A. Fake-Anbieter: vollständiger Vertrag ─────────────────────────────────
console.log("[A] FakeVideoProvider — submit → status → fetchResult");
{
  const provider = new FakeVideoProvider({ pollsUntilDone: 2 });
  const submitted = await provider.submit(request());
  eq("submit liefert eine providerJobId", submitted.providerJobId, "clip-0001");
  eq("submit liefert das Modell", submitted.model, "fake-test-video-1");

  eq("status #1 = processing", (await provider.status(submitted.providerJobId)).state, "processing");
  eq("status #2 = succeeded", (await provider.status(submitted.providerJobId)).state, "succeeded");
  eq("status bleibt succeeded", (await provider.status(submitted.providerJobId)).state, "succeeded");

  const result = await provider.fetchResult(submitted.providerJobId);
  eq("contentType = video/mp4", result.contentType, "video/mp4");
  const header = new TextDecoder().decode(result.bytes.slice(4, 8));
  eq("Container-Kopf ist ein MP4-`ftyp`", header, "ftyp");
  // Box-Walker: die Summe der Box-Größen MUSS die Dateilänge ergeben, sonst ist
  // der Container strukturell kaputt (und späteres Stitching unmöglich).
  const boxTypes: string[] = [];
  let offset = 0;
  while (offset < result.bytes.length) {
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    const size = view.getUint32(offset, false);
    if (size < 8 || offset + size > result.bytes.length) {
      boxTypes.push(`KAPUTT@${offset}`);
      break;
    }
    boxTypes.push(new TextDecoder().decode(result.bytes.slice(offset + 4, offset + 8)));
    offset += size;
  }
  eq("Box-Struktur ist vollständig (ftyp/free/mdat)", boxTypes, ["ftyp", "free", "mdat"]);
  eq("Box-Größen summieren sich zur Dateilänge", offset, result.bytes.length);
  check("Datei ist nicht leer", result.bytes.length > 1024, `${result.bytes.length} Bytes`);

  // Determinismus: gleiche Anfrage ⇒ gleiche Bytes
  const again = await provider.fetchResult(submitted.providerJobId);
  eq("zweiter Abruf liefert identische Bytes (deterministisch)", sha256(again.bytes), sha256(result.bytes));
  eq("Zähler: 1 submit, 3 status, 2 fetchResult", provider.calls, {
    submit: 1,
    status: 3,
    fetchResult: 2,
    cancel: 0,
  });
}

// ── B. Fake: Idempotenz, Fehlerpfade, Abbruch ───────────────────────────────
console.log("\n[B] Fake — Idempotenz, Fehler, Abbruch");
{
  const provider = new FakeVideoProvider({ pollsUntilDone: 1 });
  const first = await provider.submit(request({ externalTaskId: "clip-idem" }));
  const second = await provider.submit(request({ externalTaskId: "clip-idem" }));
  eq("gleicher externalTaskId ⇒ gleiche providerJobId", second.providerJobId, first.providerJobId);
  eq("… und nur EIN echter submit", provider.calls.submit, 2); // zwei Aufrufe, ein Auftrag

  await throwsCode(
    "fetchResult vor 'succeeded' ⇒ not_ready",
    () => provider.fetchResult("clip-idem"),
    "not_ready",
  );
  await throwsCode("status eines unbekannten Auftrags ⇒ unknown_job", () => provider.status("gibt-es-nicht"), "unknown_job");
}
{
  const failing = new FakeVideoProvider({ fail: true, failCode: "provider_safety_block" });
  const submitted = await failing.submit(request({ externalTaskId: "clip-fail" }));
  const status = await failing.status(submitted.providerJobId);
  eq("Fehlerpfad: status = failed", status.state, "failed");
  eq("Fehlerpfad: normalisierter Code", status.errorCode, "provider_safety_block");
  await throwsCode("Fehlerpfad: kein Ergebnis abrufbar", () => failing.fetchResult(submitted.providerJobId), "not_ready");
}
{
  const hanging = new FakeVideoProvider({ neverFinishes: true });
  const submitted = await hanging.submit(request({ externalTaskId: "clip-hang" }));
  let state = "processing";
  for (let i = 0; i < 5; i += 1) state = (await hanging.status(submitted.providerJobId)).state;
  eq("nie fertiger Auftrag bleibt 'processing' (Timeout-Test)", state, "processing");
  await hanging.cancel?.(submitted.providerJobId);
  await throwsCode("nach cancel ist der Auftrag unbekannt", () => hanging.status(submitted.providerJobId), "unknown_job");
}
{
  const short = buildFakeMp4(request({ durationSeconds: 3, externalTaskId: "a" }));
  const long = buildFakeMp4(request({ durationSeconds: 10, externalTaskId: "a" }));
  check("Datei wächst mit der Dauer", long.length > short.length, `${short.length} → ${long.length}`);
  const other = buildFakeMp4(request({ durationSeconds: 3, externalTaskId: "b" }));
  check("anderer Clip ⇒ anderer Hash", sha256(other) !== sha256(short));
}

// ── C. KEIN Netz im Fake-Pfad ───────────────────────────────────────────────
console.log("\n[C] Netz-Beweis (Wächter-fetch)");
eq("kein einziger fetch-Aufruf im Fake-Pfad", networkCalls, 0);

// ── D. Kling-Adapter: hart abgeschaltet ─────────────────────────────────────
console.log("\n[D] Kling-Adapter (Struktur) — ohne Flag/Key definierter Fehler, kein Netz");
{
  const provider = createKlingFalProvider({ env: {} });
  eq("id", provider.id, "kling-fal");
  eq("caps.supportsEndImage ist NICHT belegt ⇒ false", provider.caps.supportsEndImage, false);
  eq("klingFalEnabled({}) = false", klingFalEnabled({}), false);
  eq(
    "Grund nennt das fehlende Flag",
    klingFalDisabledReason({}),
    "VIDEO_PROVIDER_ENABLED ist nicht 'true'",
  );
  await throwsCode("submit ohne Flag/Key ⇒ provider_disabled", () => provider.submit(request()), "provider_disabled");
  await throwsCode("status ohne Flag/Key ⇒ provider_disabled", () => provider.status("x"), "provider_disabled");
  await throwsCode("fetchResult ohne Flag/Key ⇒ provider_disabled", () => provider.fetchResult("x"), "provider_disabled");
  eq("… und kein Netz-Aufruf dabei", networkCalls, 0);
}
{
  // Nur Flag, kein Key
  const onlyFlag = { VIDEO_PROVIDER_ENABLED: "true" };
  eq("Flag ohne Key ⇒ weiter aus", klingFalEnabled(onlyFlag), false);
  eq("Grund nennt den fehlenden Key", klingFalDisabledReason(onlyFlag), "FAL_KEY ist nicht gesetzt");
  const provider = createKlingFalProvider({ env: onlyFlag });
  await throwsCode("Flag ohne Key ⇒ provider_disabled", () => provider.submit(request()), "provider_disabled");
  eq("weiterhin 0 Netz-Aufrufe", networkCalls, 0);
}
{
  // Flag + Key, aber ohne die ausdrückliche Netz-Freigabe
  const flagAndKey = { VIDEO_PROVIDER_ENABLED: "true", FAL_KEY: "test-key-nicht-echt" };
  eq("Flag+Key ohne Netz-Freigabe ⇒ weiter aus", klingFalEnabled(flagAndKey), false);
  const provider = createKlingFalProvider({ env: flagAndKey });
  await throwsCode("Flag+Key ohne Netz-Freigabe ⇒ provider_disabled", () => provider.submit(request()), "provider_disabled");
  eq("weiterhin 0 Netz-Aufrufe", networkCalls, 0);
}
{
  // Alle drei Tore offen — aber gegen einen STUB-fetch: die Struktur ist belegt,
  // das echte Netz bleibt unberührt (der globale Wächter zählt weiter 0).
  const allOpen = { VIDEO_PROVIDER_ENABLED: "true", FAL_KEY: "test-key-nicht-echt", VIDEO_PROVIDER_ALLOW_NETWORK: "true" };
  eq("alle drei Tore offen ⇒ enabled", klingFalEnabled(allOpen), true);
  eq("kein Grund mehr", klingFalDisabledReason(allOpen), null);
  const provider = createKlingFalProvider({
    env: allOpen,
    fetchImpl: stubFetch({ json: { request_id: "req_123" } }),
  });
  const submitted = await provider.submit(request());
  eq("Struktur: submit liefert die request_id des Anbieters", submitted.providerJobId, "req_123");
  eq("Struktur: Modellname", submitted.model, "kling-video/v2.5-turbo/pro/image-to-video");
  eq("der globale Netz-Wächter bleibt bei 0", networkCalls, 0);
}

// ── E. Registry: fail-closed ────────────────────────────────────────────────
console.log("\n[E] Registry");
{
  check("'fake' ist auflösbar", resolveVideoProvider("fake") instanceof FakeVideoProvider);
  await throwsCode(
    "unbekannte ID ⇒ UnknownVideoProviderError (kein stiller Default)",
    () => resolveVideoProvider("sora-2"),
    "unknown_provider",
  );
  await throwsCode(
    "'kling-direct' hat (noch) keinen Adapter ⇒ Fehler, kein Ersatz",
    () => resolveVideoProvider("kling-direct"),
    "unknown_provider",
  );
  await throwsCode(
    "'minimax-fal' hat (noch) keinen Adapter ⇒ Fehler",
    () => resolveVideoProvider("minimax-fal"),
    "unknown_provider",
  );
  eq("Whitelist der IDs", [...KNOWN_VIDEO_PROVIDER_IDS], ["fake", "kling-fal", "kling-direct", "minimax-fal"]);
  check("Fehlertyp ist die exportierte Klasse", (() => {
    try {
      resolveVideoProvider("nope");
      return false;
    } catch (err) {
      return err instanceof UnknownVideoProviderError;
    }
  })());
}

// ── F. caps-Prüfung: Fähigkeit wird NICHT geraten ───────────────────────────
console.log("\n[F] validateClipRequest + caps");
{
  const fake = new FakeVideoProvider();
  const kling = createKlingFalProvider({ env: {} });

  let validOk = true;
  try {
    validateClipRequest(fake, request());
  } catch {
    validOk = false;
  }
  check("gültige Anfrage passiert beim Fake", validOk);

  let fakeEndImageOk = true;
  try {
    validateClipRequest(fake, request({ endImage: { base64: "AAAA", mime: "image/jpeg" } }));
  } catch {
    fakeEndImageOk = false;
  }
  check("Fake akzeptiert ein Endbild (caps.supportsEndImage = true)", fakeEndImageOk);

  let klingEndImageCode: string | undefined;
  try {
    validateClipRequest(kling, request({ endImage: { base64: "AAAA", mime: "image/jpeg" } }));
  } catch (err) {
    klingEndImageCode = (err as { code?: string }).code;
  }
  eq(
    "kling-fal + Endbild ⇒ capability_unsupported (VOR dem Aufruf)",
    klingEndImageCode,
    "capability_unsupported",
  );
  check("Fehlertyp ist VideoCapabilityError", (() => {
    try {
      validateClipRequest(kling, request({ endImage: { base64: "AAAA", mime: "image/png" } }));
      return false;
    } catch (err) {
      return err instanceof VideoCapabilityError;
    }
  })());

  await throwsCode("Dauer 2 s ⇒ invalid_request", () => validateClipRequest(fake, request({ durationSeconds: 2 })), "invalid_request");
  await throwsCode("Dauer 11 s ⇒ invalid_request", () => validateClipRequest(fake, request({ durationSeconds: 11 })), "invalid_request");
  await throwsCode("Dauer 7.5 s ⇒ invalid_request (nicht ganzzahlig)", () => validateClipRequest(fake, request({ durationSeconds: 7.5 })), "invalid_request");
  await throwsCode("leerer Prompt ⇒ invalid_request", () => validateClipRequest(fake, request({ prompt: "   " })), "invalid_request");
  await throwsCode("audio true ⇒ invalid_request", () => validateClipRequest(fake, request({ audio: true as unknown as false })), "invalid_request");
  await throwsCode(
    "multiShot fehlt ⇒ invalid_request (Kling defaultet sonst auf TRUE)",
    () => validateClipRequest(fake, request({ multiShot: undefined as unknown as false })),
    "invalid_request",
  );
  await throwsCode(
    "1080p ⇒ invalid_request (nur 720p freigegeben)",
    () => validateClipRequest(fake, request({ resolution: "1080p" as unknown as "720p" })),
    "invalid_request",
  );
  await throwsCode(
    "externalTaskId fehlt ⇒ invalid_request",
    () => validateClipRequest(fake, request({ externalTaskId: "" })),
    "invalid_request",
  );
  await throwsCode(
    "4 Elemente ⇒ invalid_request (max. 3)",
    () => validateClipRequest(fake, request({ elementIds: ["a", "b", "c", "d"] })),
    "invalid_request",
  );
  await throwsCode(
    "Elemente ohne cap ⇒ capability_unsupported",
    () => validateClipRequest(fake, request({ elementIds: ["a"] })),
    "capability_unsupported",
  );
}

// ── G. Abschluss: der globale Netz-Wächter war NIE beteiligt ────────────────
console.log("\n[G] Abschluss-Netzbeweis");
eq("fetch-Aufrufe über den Wächter insgesamt", networkCalls, 0);
check("kein Wächter-Aufruf protokolliert", networkUrls.length === 0, networkUrls.join(","));
globalThis.fetch = realFetch;

console.log(`\n— Ergebnis: ${pass} PASS, ${fail} FAIL —`);
if (fail > 0) {
  console.log("Fehlgeschlagen:");
  for (const f of failures) console.log("  · " + f);
  process.exit(1);
}
process.exit(0);

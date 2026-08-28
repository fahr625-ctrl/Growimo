// TikTok-Bereich test — reale GPT-4o-Aufrufe je Modus.
// Usage: bun --env-file=.env run scripts/test-tiktok.ts
import { generateTikTok, type TikTokResult } from "../src/ai/tiktok";

const BIZ = "Handgemachte Keramiktassen mit Duftkerzen";
const fmt = (s: string) => s.replace(/\n/g, " ").slice(0, 120);

function checkIdea(r: TikTokResult, mode: string) {
  if (r.mode === "diagnose") throw new Error("expected idea result for " + mode);
  const fields = {
    idea: r.idea,
    hook: r.hook,
    length: r.length,
    scenes: r.scenes,
    overlays: r.overlays,
    caption: r.caption,
    hashtags: r.hashtags,
    cta: r.cta,
    why: r.why,
  };
  const missing = Object.entries(fields).filter(([k, v]) =>
    Array.isArray(v) ? (v as unknown[]).length === 0 : typeof v === "string" && !(v as string).trim()
  );
  // spokenText is OPTIONAL by design (can legitimately be empty when the idea
  // doesn't need an on-camera script) — it must exist as a field but may be "".
  if (!("spokenText" in r)) throw new Error("[todayIdea] missing spokenText field");
  if (missing.length > 0) throw new Error(`[${mode}] missing fields: ${missing.map(([k]) => k).join(",")}`);
  if (r.scenes.length < 3) throw new Error(`[${mode}] too few scenes: ${r.scenes.length}`);
  if (r.hashtags.length < 4) throw new Error(`[${mode}] too few hashtags: ${r.hashtags.length}`);
  console.log(`✅ [${mode}] all idea fields present (scenes=${r.scenes.length}, hashtags=${r.hashtags.length}, overlays=${r.overlays.length})`);
}

function checkDiagnose(r: TikTokResult) {
  if (r.mode !== "diagnose") throw new Error("expected diagnose result");
  if (!r.biggestProblem.trim()) throw new Error("missing biggestProblem");
  if (r.whatWorks.length === 0) throw new Error("missing whatWorks");
  if (r.whatToImprove.length === 0) throw new Error("missing whatToImprove");
  if (!r.newHook.trim()) throw new Error("missing newHook");
  if (r.optimized.trim().length < 20) throw new Error("optimized too short");
  if (!r.nextTest.trim()) throw new Error("missing nextTest");
  console.log(`✅ [diagnose] all diagnosis fields present (works=${r.whatWorks.length}, improve=${r.whatToImprove.length})`);
}

async function main() {
  // (a) todayIdea — OHNE dass der Nutzer eine Videoart nennt.
  console.log("\n=== (a) todayIdea (de, Ziel: Verkäufe) ===");
  const a = await generateTikTok(
    { mode: "todayIdea", biz: BIZ, goal: "Verkäufe" },
    "de",
  );
  checkIdea(a, "todayIdea");
  console.log("   idea  :", fmt((a as { idea: string }).idea));
  console.log("   hook  :", fmt((a as { hook: string }).hook));
  console.log("   why   :", fmt((a as { why: string }).why));

  // (b) concept — mit konkretem Thema.
  console.log("\n=== (b) concept (de, Thema: Mug als Geschenk) ===");
  const b = await generateTikTok(
    { mode: "concept", biz: BIZ, goal: "Verkäufe", topic: "Keramiktasse als persönliches Geschenk verpacken" },
    "de",
  );
  checkIdea(b, "concept");
  console.log("   idea  :", fmt((b as { idea: string }).idea));

  // (c) diagnose — echte Metriken (schlechte Retention).
  console.log("\n=== (c) diagnose (de, Flop-Daten) ===");
  const c = await generateTikTok(
    {
      mode: "diagnose",
      biz: BIZ,
      metrics: {
        views: 320,
        length: "40s",
        avgWatch: 2.5,
        likes: 4,
        comments: 0,
        shares: 1,
        profileVisits: 2,
      },
    },
    "de",
  );
  checkDiagnose(c);
  console.log("   problem:", fmt((c as { biggestProblem: string }).biggestProblem));
  console.log("   newHook:", fmt((c as { newHook: string }).newHook));
  console.log("   nextTest:", fmt((c as { nextTest: string }).nextTest));

  // (d) todayIdea auf Englisch (Locale-Wechsel).
  console.log("\n=== (d) todayIdea (en) ===");
  const d = await generateTikTok({ mode: "todayIdea", biz: BIZ, goal: "Sales" }, "en");
  checkIdea(d, "todayIdea-en");
  const dd = d as { idea: string; caption: string; why: string };
  if (/\w/.test(dd.caption) === false) throw new Error("empty caption");
  console.log("   idea(EN):", fmt(dd.idea));

  console.log("\n✅ TikTok alle 3 Modi (de) + heute-Idee (en) bestanden.");
}

main().catch((err) => {
  console.error("\n❌ Test fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exit(1);
});

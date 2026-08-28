// TikTok todayIdea — Prompt-Qualitäts-Test (TikTok-nativ, nicht-werblich).
// Führt den todayIdea-Modus mit realen GPT-4o-Aufrufen über mehrere Unternehmen aus
// und gibt die tatsächlichen Antworten (idea/hook/length/scenes/cta) als Beleg aus.
// Usage: bun --env-file=.env run scripts/test-tiktok-nativ.ts
import { generateTikTok, type TikTokIdeaResult } from "../src/ai/tiktok";

const CASES: { label: string; biz: string; goal?: string; audience?: string; lang: "de" | "en" }[] = [
  { label: "Keramiktassen (low-context)", biz: "Handgemachte Keramiktassen mit Duftkerzen", goal: "Verkäufe", lang: "de" },
  { label: "Keramiktassen run2", biz: "Handgemachte Keramiktassen", goal: "Reichweite", audience: "kreative Frauen ab 25", lang: "de" },
  { label: "Digitalagentur (generic-prone)", biz: "Digitalagentur für kleine Unternehmen", goal: "Follower", lang: "de" },
  { label: "Reinigungsfirma (generic-prone)", biz: "Reinigungsfirma für Büros und Privathaushalte", goal: "Reichweite", lang: "de" },
  { label: "EN: Ceramic mugs (english)", biz: "Handmade ceramic mugs with scented candles", goal: "Sales", lang: "en" },
];

async function main() {
  for (const c of CASES) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`=== ${c.label} — lang=${c.lang} goal=${c.goal} audience=${c.audience ?? "-"}`);
    console.log("=".repeat(70));
    try {
      const r = (await generateTikTok(
        { mode: "todayIdea", biz: c.biz, goal: c.goal, audience: c.audience },
        c.lang,
      )) as TikTokIdeaResult;
      console.log("IDEA   :", r.idea);
      console.log("HOOK   :", r.hook);
      console.log("LENGTH :", r.length);
      console.log("SCENES :");
      r.scenes.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
      console.log("OVERLAYS:", r.overlays.join(" | "));
      console.log("SPOKEN :", r.spokenText);
      console.log("CAPTION:", r.caption);
      console.log("TAGS   :", r.hashtags.join(" "));
      console.log("CTA    :", r.cta);
      console.log("WHY    :", r.why);
    } catch (e) {
      console.error("ERROR:", e instanceof Error ? e.message : e);
    }
  }
  console.log("\n✅ done");
}

main();

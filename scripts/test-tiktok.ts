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

  // (e) BETAFALL: Growimo-self Beta ohne Nutzerfeedback → muss eine authentische,
  //     real umsetzbare Beta-Demo liefern statt eines erfundenen Feedback-Zitats.
  console.log("\n=== (e) todayIdea BETA-FALL (de) — keine erfundenen Nutzer/Testimonials ===");
  const e = await generateTikTok(
    {
      mode: "todayIdea",
      biz: "Growimo — KI-Marketing-Entscheidungs-Engine",
      goal: "Reichweite",
      brandContext:
        "Growimo ist eine KI-gestützte Marketing-Entscheidungs-Engine für Creator, Unternehmer und Unternehmen. Beta gestartet, kaum Tester, frühe Phase, keine echten Nutzerstimmen vorhanden. Echte Funktionen: Video-Idee generieren, Qualitäts-Score 0-100, Auto-Verbesserung, Veröffentlichungs-Priorisierung, Kanal-Aktionspläne für Pinterest/Etsy/SEO, A/B-Varianten, Publishing-Kalender, Performance-Feedback.",
    },
    "de",
  );
  checkIdea(e, "todayIdea-beta");
  const ee = e as { idea: string; hook: string; scenes: string[]; caption: string; selfCheck?: { inventsUserOrTestimonial: boolean } };
  console.log("   idea      :", fmt(ee.idea));
  console.log("   hook      :", fmt(ee.hook));
  console.log("   scenes    :", ee.scenes.map((s) => "      • " + s.replace(/\n/g, " ")).join("\n"));
  // Guard: eigenständige Prüfung, dass keine erfundene Nutzerstimme / echtes
  // Zitat einer echten Person als Testimonial auftaucht (zusätzlich zum selfCheck).
  const textBlob = (ee.idea + " " + ee.hook + " " + ee.caption + " " + ee.scenes.join(" ")).toLowerCase();
  const inventedKinds = [
    /nutzer(in)?\s+(sagt|berichtet|gibt.{0,30}feedback)/,
    /tester(in)?\s+(sagt|schreibt|berichtet|ist begeistert)/,
    /ein[en]?\s+(kunde|tester|nutzer).{0,30}(sagt|schreibt|ist begeistert|liebt)/,
    /eine\s+echte\s+nutzerin/,
    /"(.*?)"\s*[—-]\s*(ein[en]?\s+)?(nutzer|kunde|tester)/,
    /kun(din|de)\s+(ist|sind)\s+begeistert/,
    /user\s+(says|is excited|loves)/,
    /(kunde|nutzer|tester).{0,40}(sagt|schreibt|fand|hinterlässt).{0,15}bewertung/,
  ];
  const hits = inventedKinds.filter((re) => re.test(textBlob));
  if (ee.selfCheck?.inventsUserOrTestimonial === true) {
    throw new Error("BETA-FALL: selfCheck.inventsUserOrTestimonial==true → Idee enthält erfundenes Testimonial");
  }
  if (hits.length > 0) {
    throw new Error("BETA-FALL: Idee enthält eine erfundene Nutzer-/Testimonial-Aussage: " + hits.map((r) => r.source).join(","));
  }
  console.log("   ✅ BETA-FALL: keine erfundene Nutzer-/Testimonial-Aussage erkannt, selfCheck.inventsUserOrTestimonial=" + ee.selfCheck?.inventsUserOrTestimonial);

  // (f) NEUE REGELN A+B Nachweis: ein Kontext, der typischerweise zu konkreten
  //     Leistungs-/Zeit-Versprechen ("in nur X Sekunden/Minuten", "+X%") oder zu
  //     einer künstlichen "Wow!"-Reaktion verleitet — z. B. ein "schnelle
  //     Ergebnisse"-Produkt. Es dürfen KEINE unbelegten konkreten Versprechen
  //     und KEINE vorgegebene Begeisterung/Überraschung auftauchen.
  console.log("\n=== (f) todayIdea (de) — Regel A: keine unbelegten Leistungs-/Zeit-Versprechen, Regel B: keine künstliche Begeisterung ===");
  const f = await generateTikTok(
    {
      mode: "todayIdea",
      biz: "Fitness-App für schnelle Ergebnisse — schnelle Fettverbrennung zuhause ohne Geräte",
      goal: "Mehr Follower",
    },
    "de",
  );
  checkIdea(f, "todayIdea-regeln");
  const ff = f as { idea: string; hook: string; scenes: string[]; overlays: string[]; spokenText: string; caption: string; why: string };
  const ideaBlob = (ff.idea + " " + ff.hook + " " + ff.scenes.join(" ") + " " + ff.overlays.join(" ") + " " + ff.spokenText + " " + ff.caption + " " + ff.why).toLowerCase();
  // Regel A — konkrete, unbelegte LEISTUNGS-/ERGEBNIS-Versprechen. WICHTIG: nur
  // echte Versprechen an den Nutzer/Erfolg werden erfasst — KEINE legitimen
  // Video-Inhalts-Zeiten (z. B. eine "5-Minuten-Challenge" als Videodauer/Content
  // ist KEIN Leistungsversprechen). Erfasst werden: "in nur X Sekunden/Minuten",
  // ein Ergebnis-Verb + Zeit, Erfolgsprozente, Verdopplungs-/Garantie-Behauptungen.
  const promisePatterns = [
    /in\s+nur\s+\d+\s*(sekunden?|minuten?|tagen?|wochen?)/, // "in nur X" = typisches Zeit-Versprechen
    /(verbesser|erhöh|steigere|boost|verdoppel)\w*.{0,30}\d+\s*(sekunden?|minuten?|tagen?|wochen?)/, // Ergebnis-Verb + konkrete Zeit
    /\+\s?\d+\s*%/,                                                       // "+X%"-Erfolgsversprechen
    /\d+\s*%\s*(mehr\s+)?(engagement|reichweite|follower|klicks?|verkäufe?|erfolg)/, // Erfolgsprozente
    /verdoppel(t|n)?\s+(die\s+)?(reichweite|follower|klicks?)/,           // Reichweiten-Verdopplung
    /garantiert\s+(mehr\s+)?(reichweite|follower|erfolg|wachstum)/,       // Garantie-Behauptung
  ];
  const promiseHits = promisePatterns.filter((re) => re.test(ideaBlob));
  // Regel B — künstliche Begeisterung/Überraschung als Füllmittel:
  const cheerPatterns = [
    /(wow|whoa)\s*!/,
    /😲/,
    /da\s+staunen\s+alle/,
    /ich\s+(bin|war)\s+überrascht/,
    /(staunt|staunen)\s+überrascht/,
  ];
  const cheerHits = cheerPatterns.filter((re) => re.test(ideaBlob));
  if (promiseHits.length > 0) {
    throw new Error("Regel A VERLETZT — unbelegtes Leistungs-/Zeit-Versprechen gefunden: " + promiseHits.map((r) => r.source).join(","));
  }
  if (cheerHits.length > 0) {
    throw new Error("Regel B VERLETZT — künstliche Begeisterung/Überraschung gefunden: " + cheerHits.map((r) => r.source).join(","));
  }
  console.log("   idea  :", fmt(ff.idea));
  console.log("   hook  :", fmt(ff.hook));
  console.log("   ✅ Regel A+B: kein unbelegtes Leistungs-/Zeit-Versprechen, keine künstliche Begeisterung/Überraschung im Ergebnis.");

  console.log("\n✅ TikTok alle 3 Modi (de) + heute-Idee (en) + BETA-FALL + REGEL A/B bestanden.");
}

main().catch((err) => {
  console.error("\n❌ Test fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exit(1);
});

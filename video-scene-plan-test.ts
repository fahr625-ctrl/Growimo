// ─────────────────────────────────────────────────────────────────────────────
// VIDEO-TESTUMGEBUNG (2026-11-06) — Szenenaufteilung: reine Funktion, kein Netz
// ─────────────────────────────────────────────────────────────────────────────
// Auftrag: `tiktok-video-2026-11-05/UMSETZUNGSPLAN.md` §5.7 (12 Pflicht-Fixtures)
// + Abnahmeregel (jede Dauer ganzzahlig, Σ clip.seconds === targetSeconds).
//
//   bun video-scene-plan-test.ts
//
// Stil wie die übrigen Repo-Suiten: `check()` + Exit-Code, kein bun:test.
// Kein DB, kein Netz, keine Zeit, kein Zufall.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CLIP_MAX_SECONDS,
  CLIP_MIN_SECONDS,
  MAX_CLIPS,
  PROMPT_MAX_CHARS,
  VIDEO_PROMPT_CONSISTENCY,
  VIDEO_PROMPT_CONTINUATION,
  VIDEO_PROMPT_STYLE,
  buildClipPrompt,
  distributeInteger,
  parseLengthSeconds,
  parseSceneDuration,
  planClips,
  planClipsFromTikTokConcept,
  planClipsFromTikTokRebuilt,
  type VideoClipPlan,
} from "./src/lib/video-scene-plan";

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
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `erwartet ${e}, erhalten ${a}`);
}

/** Szenen mit Zeitmarken: [[start,end], …] → timedScenes. */
function timed(ranges: [number, number][]): { time: string; scene: string; text: string }[] {
  return ranges.map(([s, e], i) => ({
    time: `${s}-${e}s`,
    scene: `Szene ${i + 1}: Ablauf`,
    text: `eingeblendeter Text ${i + 1}`,
  }));
}

/** Szenen mit gleicher Dauer d, lückenlos aufeinanderfolgend. */
function uniform(count: number, d: number): { time: string; scene: string; text: string }[] {
  return timed(Array.from({ length: count }, (_, i) => [i * d, (i + 1) * d] as [number, number]));
}

/** Abnahmeregel als harte Assertion — nicht im Auge des Prüfers. */
function checkInvariants(label: string, plan: VideoClipPlan | null): void {
  if (!plan) {
    check(`${label}: Plan vorhanden`, false, "planClips() lieferte null");
    return;
  }
  const durations = plan.clips.map((c) => c.seconds);
  check(
    `${label}: alle Dauern ganzzahlig`,
    durations.every((d) => Number.isInteger(d)),
    JSON.stringify(durations),
  );
  check(
    `${label}: Σ clip.seconds === targetSeconds (${plan.targetSeconds})`,
    plan.secondsTotal === plan.targetSeconds,
    `Σ=${plan.secondsTotal}`,
  );
  check(
    `${label}: jeder Clip in [${CLIP_MIN_SECONDS}, ${CLIP_MAX_SECONDS}] s`,
    durations.every((d) => d >= CLIP_MIN_SECONDS && d <= CLIP_MAX_SECONDS),
    JSON.stringify(durations),
  );
  check(`${label}: höchstens ${MAX_CLIPS} Clips`, plan.clips.length <= MAX_CLIPS, `${plan.clips.length}`);
  check(
    `${label}: Clip-Indizes lückenlos`,
    plan.clips.every((c, i) => c.index === i),
  );
  check(
    `${label}: jeder Clip hat mindestens einen Szenentext im Prompt`,
    plan.clips.every((c) => c.parts.length > 0 && c.prompt.includes(VIDEO_PROMPT_STYLE)),
  );
  check(
    `${label}: Prompt-Länge ≤ ${PROMPT_MAX_CHARS}`,
    plan.clips.every((c) => c.prompt.length <= PROMPT_MAX_CHARS),
  );
}

const durationsOf = (plan: VideoClipPlan | null): number[] => (plan ? plan.clips.map((c) => c.seconds) : []);
const codesOf = (plan: VideoClipPlan | null): string[] => (plan ? plan.warnings.map((w) => w.code) : []);

console.log("— video-scene-plan-test (UMSETZUNGSPLAN §5.7) —\n");

// ── A. parseSceneDuration (§5.5) ─────────────────────────────────────────────
console.log("[A] parseSceneDuration — belegte Formen");
eq('"0-2s" → 2', parseSceneDuration("0-2s"), 2);
eq('"2-6s" → 4', parseSceneDuration("2-6s"), 4);
eq('"2–6 s" (en dash + Leerzeichen) → 4', parseSceneDuration("2–6 s"), 4);
eq('"2-6 Sek." → 4', parseSceneDuration("2-6 Sek."), 4);
eq('"2 - 6" → 4', parseSceneDuration("2 - 6"), 4);
eq('"2,5-5s" (Dezimalkomma) → 2.5', parseSceneDuration("2,5-5s"), 2.5);
eq('"" → null', parseSceneDuration(""), null);
eq('"6" (einzelne Zahl) → null', parseSceneDuration("6"), null);
eq('"Anfang" → null', parseSceneDuration("Anfang"), null);
eq('"ca. 3s" → null', parseSceneDuration("ca. 3s"), null);
eq('"4-4" (Ende = Start) → null', parseSceneDuration("4-4"), null);
eq("null → null", parseSceneDuration(null), null);

console.log("\n[B] parseLengthSeconds");
eq('"20–30 Sekunden" → 25', parseLengthSeconds("20–30 Sekunden"), 25);
eq('"30 Sekunden" → 30', parseLengthSeconds("30 Sekunden"), 30);
eq('"20 s" → 20', parseLengthSeconds("20 s"), 20);
eq('"ca. 25s" → 25', parseLengthSeconds("ca. 25s"), 25);
eq('"kurz" → null', parseLengthSeconds("kurz"), null);

// ── C. Die 12 Pflicht-Fixtures (§5.7) ────────────────────────────────────────
console.log("\n[C] Fixtures T1–T12");

// T1 — 5 Szenen × 4 s ⇒ 3 Clips 8/8/4, Σ 20
const t1 = planClips({ timedScenes: uniform(5, 4) });
checkInvariants("T1", t1);
eq("T1: 3 Clips 8/8/4", durationsOf(t1), [8, 8, 4]);
eq("T1: Σ 20", t1?.secondsTotal, 20);
eq("T1: keine Warnung nötig", codesOf(t1), []);

// T2 — 3 Szenen × 10 s ⇒ 10/10/10
const t2 = planClips({ timedScenes: uniform(3, 10) });
checkInvariants("T2", t2);
eq("T2: 10/10/10", durationsOf(t2), [10, 10, 10]);

// T3 — 4 Szenen × 5 s ⇒ 10/10
const t3 = planClips({ timedScenes: uniform(4, 5) });
checkInvariants("T3", t3);
eq("T3: 10/10", durationsOf(t3), [10, 10]);

// T4 — 6 Szenen × 5 s ⇒ 10/10/10
const t4 = planClips({ timedScenes: uniform(6, 5) });
checkInvariants("T4", t4);
eq("T4: 10/10/10", durationsOf(t4), [10, 10, 10]);

// T5 — 5 Szenen × 6 s: Durchlauf 1 ergäbe 5 Clips ⇒ Durchlauf 2: 3 × 10
const t5 = planClips({ timedScenes: uniform(5, 6) });
checkInvariants("T5", t5);
eq("T5: 3 × 10 (Durchlauf 2)", durationsOf(t5), [10, 10, 10]);
eq("T5: Σ 30", t5?.secondsTotal, 30);

// T6 — 3 Szenen × 3 s (9 s) ⇒ 1 Clip à 9 s + Warnung
const t6 = planClips({ timedScenes: uniform(3, 3) });
checkInvariants("T6", t6);
eq("T6: 1 Clip à 9 s", durationsOf(t6), [9]);
check("T6: Warnung 'kürzer als 20 s'", codesOf(t6).includes("shorter_than_target"), codesOf(t6).join(","));

// T7 — 5 Szenen × 8 s (40 s) ⇒ 3 × 10, gestrafft, alle Szenen im Prompt
const t7 = planClips({ timedScenes: uniform(5, 8) });
checkInvariants("T7", t7);
eq("T7: 3 × 10", durationsOf(t7), [10, 10, 10]);
check("T7: Warnung 'auf 30 s gestrafft'", codesOf(t7).includes("condensed_to_30"), codesOf(t7).join(","));
const t7Scenes = new Set(t7?.clips.flatMap((c) => c.parts.map((p) => p.sceneIndex)));
eq("T7: alle 5 Szenen kommen vor", [...t7Scenes].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
const t7PromptTexts = (t7?.clips ?? []).map((c) => c.prompt).join("\n");
check(
  "T7: alle 5 Szenentexte stehen in den Prompts",
  [1, 2, 3, 4, 5].every((n) => t7PromptTexts.includes(`Szene ${n}:`)),
);

// T8 — 1 Szene „0-15s" ⇒ 2 Clips 10/5, gleicher Szenentext, Zusatz „continuation"
const t8 = planClips({ timedScenes: [{ time: "0-15s", scene: "Ein durchgehender Shot", text: "" }] });
checkInvariants("T8", t8);
eq("T8: 10/5", durationsOf(t8), [10, 5]);
check("T8: Warnung 'Szene geteilt'", codesOf(t8).includes("scene_split"), codesOf(t8).join(","));
check(
  "T8: beide Clips tragen denselben Szenentext",
  (t8?.clips ?? []).every((c) => c.prompt.includes("Ein durchgehender Shot")),
);
check(
  "T8: zweiter Clip trägt den continuation-Zusatz",
  (t8?.clips[1]?.prompt ?? "").includes(VIDEO_PROMPT_CONTINUATION) &&
    !(t8?.clips[0]?.prompt ?? "").includes(VIDEO_PROMPT_CONTINUATION),
);

// T9 — timedScenes fehlt, scenes = 4 Stichpunkte, length = „20–30 Sekunden" ⇒ 25 s, 10/10/5
const t9 = planClips({
  scenes: ["Produkt zeigen", "Detailaufnahme", "Anwendung", "Call to Action"],
  length: "20–30 Sekunden",
});
checkInvariants("T9", t9);
eq("T9: 3 Clips 10/10/5", durationsOf(t9), [10, 10, 5]);
eq("T9: Ziel 25 s (Mittelwert der Spanne)", t9?.targetSeconds, 25);
check("T9: estimated = true", t9?.estimated === true);
check("T9: Warnung 'Szenen-Fallback'", codesOf(t9).includes("scenes_fallback"), codesOf(t9).join(","));

// T10 — beides fehlt ⇒ null (kein Button)
eq("T10: kein Szenenplan ⇒ null", planClips({ timedScenes: null, scenes: null }), null);
eq("T10: leeres scenes[] ⇒ null", planClips({ scenes: [] }), null);
eq("T10: leerer timedScenes[] ohne scenes ⇒ null", planClips({ timedScenes: [] }), null);
eq("T10: undefined-Eingabe ⇒ null", planClips({}), null);

// T11 — alle time = „Anfang" ⇒ gleichmäßig, Warnung, kein Absturz
const t11 = planClips({
  timedScenes: Array.from({ length: 4 }, (_, i) => ({ time: "Anfang", scene: `Szene ${i + 1}`, text: "" })),
  length: "20–30 Sekunden",
});
checkInvariants("T11", t11);
eq("T11: 3 Clips 10/10/5 (T = 25 geschätzt)", durationsOf(t11), [10, 10, 5]);
check("T11: Warnung 'Dauer geschätzt'", codesOf(t11).includes("durations_estimated"), codesOf(t11).join(","));

// T12 — 12 Szenen × 2,5 s (30 s) ⇒ 3 Clips, Σ exakt 30
const t12 = planClips({
  timedScenes: Array.from({ length: 12 }, (_, i) => ({
    time: `${(i * 2.5).toString().replace(".", ",")}-${((i + 1) * 2.5).toString().replace(".", ",")}s`,
    scene: `Szene ${i + 1}`,
    text: "",
  })),
});
checkInvariants("T12", t12);
eq("T12: 3 Clips, Σ exakt 30", t12?.secondsTotal, 30);
eq("T12: 3 × 10", durationsOf(t12), [10, 10, 10]);

// ── D. Randfälle (§5.4) ──────────────────────────────────────────────────────
console.log("\n[D] Randfälle");

// Eine einzelne Szene unter dem Anbieter-Minimum wird angehoben, nicht gestreckt.
const d1 = planClips({ timedScenes: [{ time: "0-2s", scene: "Kurz", text: "" }] });
checkInvariants("D1 (1 Szene à 2 s)", d1);
eq("D1: 1 Clip à 3 s (Anbieter-Minimum)", durationsOf(d1), [3]);
check("D1: Warnung 'kürzer als 20 s'", codesOf(d1).includes("shorter_than_target"));

// Genau 30 s mit 2 Szenen ⇒ 10/10/10 ist NICHT möglich (nur 2 Szenen) ⇒ Durchlauf 2 teilt.
const d2 = planClips({ timedScenes: uniform(2, 15) });
checkInvariants("D2 (2 Szenen à 15 s)", d2);
eq("D2: 3 × 10 (beide Szenen geteilt)", durationsOf(d2), [10, 10, 10]);

// 30 s aus 3 Szenen mit krummen Sekunden (3-13 / 13-21 / 21-30 = 10/8/9).
const d3 = planClips({ timedScenes: timed([[0, 3], [3, 13], [13, 21], [21, 30]]) });
checkInvariants("D3 (krumme Sekunden)", d3);
eq("D3: Σ 30", d3?.secondsTotal, 30);

// 14 s (10-19 s Korridor) ⇒ 10 + 4
const d4 = planClips({ timedScenes: uniform(7, 2) });
checkInvariants("D4 (7 × 2 s = 14 s)", d4);
eq("D4: 10/4", durationsOf(d4), [10, 4]);

// Diagnose-v2-Pfad (rebuilt.seconds statt length)
// Ohne Szenen gibt es nichts zu teilen — auch wenn `seconds` bekannt ist.
const d5 = planClipsFromTikTokRebuilt({ timedScenes: [], seconds: 20 });
check("D5: kein Szenenplan ⇒ null (Diagnose ohne Szenen)", d5 === null);

const d6 = planClipsFromTikTokRebuilt({ timedScenes: uniform(5, 4), seconds: 30 });
eq("D6: timedScenes gewinnen gegen seconds", durationsOf(d6), [8, 8, 4]);

// Konzept-Pfad: timedScenes haben Vorrang vor scenes[]
const d7 = planClipsFromTikTokConcept({ timedScenes: uniform(3, 10), scenes: ["a", "b"], length: "20 s" });
eq("D7: timedScenes vor scenes[]", durationsOf(d7), [10, 10, 10]);
eq("D7: null-Eingabe ⇒ null", planClipsFromTikTokConcept(null), null);

// Eingeblendeter Text darf NICHT in den Prompt (§5.6) — er ist ein Overlay-Thema.
const d8 = planClips({ timedScenes: uniform(4, 5) });
check(
  "D8: `text` steht nicht im Prompt",
  (d8?.clips ?? []).every((c) => !c.prompt.includes("eingeblendeter Text")),
);
check(
  "D8: STIL + KONSISTENZ sind enthalten",
  (d8?.clips ?? []).every((c) => c.prompt.startsWith(VIDEO_PROMPT_STYLE) && c.prompt.endsWith(VIDEO_PROMPT_CONSISTENCY)),
);

// Deterministisch: zweimal derselbe Aufruf ⇒ identisches Ergebnis (kein Zufall, keine Zeit).
const run1 = planClips({ timedScenes: uniform(5, 8) });
const run2 = planClips({ timedScenes: uniform(5, 8) });
eq("D9: zweimal aufgerufen ⇒ identisch", run1, run2);

// ── E. Verteilung (größte Reste) ─────────────────────────────────────────────
console.log("\n[E] distributeInteger");
eq("25 auf 4 gleiche Gewichte", distributeInteger(25, [1, 1, 1, 1]), [7, 6, 6, 6]);
eq("30 auf 12 × 2,5", distributeInteger(30, new Array(12).fill(2.5)), [3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2]);
eq("Summe bleibt exakt", distributeInteger(17, [5, 1, 9, 3]).reduce((a, b) => a + b, 0), 17);
check("jede Szene mindestens 1 s", distributeInteger(5, [10, 10, 10, 10, 10]).every((v) => v >= 1));
eq("leere Gewichte ⇒ leer", distributeInteger(10, []), []);

// ── F. Prompt-Bau ────────────────────────────────────────────────────────────
console.log("\n[F] buildClipPrompt");
const p = buildClipPrompt(["Ein Mensch öffnet die Tür", "Er tritt ein"], true);
check("beginnt mit STIL", p.startsWith(VIDEO_PROMPT_STYLE));
check("enthält beide Szenentexte", p.includes("Ein Mensch öffnet die Tür") && p.includes("Er tritt ein"));
check("enthält continuation", p.includes(VIDEO_PROMPT_CONTINUATION));
check("endet mit KONSISTENZ", p.endsWith(VIDEO_PROMPT_CONSISTENCY));
const longPrompt = buildClipPrompt([("x".repeat(3000))]);
eq(`Kappung auf ${PROMPT_MAX_CHARS} Zeichen`, longPrompt.length, PROMPT_MAX_CHARS);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n— Ergebnis: ${pass} PASS, ${fail} FAIL —`);
if (fail > 0) {
  console.log("Fehlgeschlagen:");
  for (const f of failures) console.log("  · " + f);
  process.exit(1);
}
process.exit(0);

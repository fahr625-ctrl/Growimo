/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — Szenenaufteilung als REINE FUNKTION.
 *
 * Grundlage: `tiktok-video-2026-11-05/UMSETZUNGSPLAN.md` §5 (Szenenaufteilung),
 * §5.3 (Beispiel 5×4 s ⇒ 8/8/4), §5.4 (Randfälle), §5.5 (parseSceneDuration),
 * §5.6 (Prompt-Bau), §5.7 (12 Pflicht-Fixtures).
 *
 * HARTE REGEL DIESER DATEI: keine Netzwerk-, keine DB-Aufrufe, keine Zeit
 * (`Date.now`/`new Date`), kein Zufall, kein LLM. Dieselbe Eingabe liefert
 * immer dieselbe Ausgabe — sonst wäre der Plan nicht prüfbar.
 *
 * Abnahmeregel (§5.7): jede Clip-Dauer ist GANZZAHLIG und
 * `Σ clip.seconds === targetSeconds` — als Assertion im Test, nicht im Auge.
 */

// ── Grenzen (§5.2) ───────────────────────────────────────────────────────────
/** Längster Clip pro Anbieter-Aufruf — Owner-Grenze 10 s (Anbieter könnte 15). */
export const CLIP_MAX_SECONDS = 10;
/** Kürzester Clip (Kling-Enum beginnt bei 3). */
export const CLIP_MIN_SECONDS = 3;
/** Zielkorridor des fertigen Videos. */
export const TARGET_MIN_SECONDS = 20;
export const TARGET_MAX_SECONDS = 30;
/** Mehr Aufrufe werden nicht gemacht — kein stiller 4. Clip (§5.2 Schritt 5). */
export const MAX_CLIPS = 3;
/** Annahme, wenn nichts anderes bekannt ist (§5.2 Schritt 3d). */
export const DEFAULT_TARGET_SECONDS = 25;
/** Harte Prompt-Obergrenze (belegt max. 3072, empfohlen ≤ 2500 — §5.6). */
export const PROMPT_MAX_CHARS = 2400;

/** Prompt-Bausteine, englisch (§5.6 — bessere Modelltreue). */
export const VIDEO_PROMPT_STYLE =
  'photorealistic cinematic footage, vertical 9:16 framing, natural lighting, slow continuous camera movement, no text overlays, no captions, no logos, no watermark, no subtitles';
export const VIDEO_PROMPT_CONSISTENCY =
  'same subject, same clothing, same location, same lighting and colour palette as the reference frame, continuous look, single unbroken take';
export const VIDEO_PROMPT_CONTINUATION = 'continuation of the same shot, same moment, no cut';

// ── Typen ────────────────────────────────────────────────────────────────────
/** Eingabe: die Felder, die es in `src/ai/tiktok.ts` WIRKLICH gibt (§5.1). */
export interface VideoSceneSource {
  /** `TikTokTimedScene[]` — Zeit + Szene + Text. */
  timedScenes?: { time?: string | null; scene?: string | null; text?: string | null }[] | null;
  /** `string[]` — nur Stichpunkte, OHNE Zeitmarken (Fallback). */
  scenes?: string[] | null;
  /** `rebuilt.seconds` (nur Diagnose). */
  seconds?: number | null;
  /** z. B. „20–30 Sekunden". */
  length?: string | null;
}

export type VideoPlanWarningCode =
  | 'shorter_than_target'
  | 'condensed_to_30'
  | 'durations_estimated'
  | 'scenes_fallback'
  | 'scene_split'
  | 'clip_merged'
  | 'clip_rebalanced'
  | 'target_raised_for_scene_count';

export interface VideoPlanWarning {
  code: VideoPlanWarningCode;
  /** Deutscher Klartext für Dialog/Log. Die UI bildet `code` auf i18n ab. */
  message: string;
}

/** Ein Anteil einer Szene an einem Clip (bei geteilten Szenen zwei Anteile). */
export interface PlannedClipPart {
  sceneIndex: number;
  seconds: number;
  /** true = Fortsetzung derselben Szene aus dem vorigen Clip (§5.4). */
  continued: boolean;
}

export interface PlannedClip {
  index: number;
  seconds: number;
  parts: PlannedClipPart[];
  /** §5.6 — deterministisch gebaut, ohne LLM. */
  prompt: string;
}

export interface VideoClipPlan {
  clips: PlannedClip[];
  /** Immer gleich `targetSeconds` (Abnahmeregel §5.7). */
  secondsTotal: number;
  sceneCount: number;
  targetSeconds: number;
  /** true = Dauer beruht auf einer Schätzung, nicht auf Zeitmarken. */
  estimated: boolean;
  warnings: VideoPlanWarning[];
}

// ── Parsing (§5.5) ───────────────────────────────────────────────────────────

/** Einheiten, die nach einer Sekundenzahl stehen dürfen (nur toleriert). */
const UNIT = String.raw`(?:s|sek\.?|sekunden?|sec\.?|seconds?)?`;

/**
 * „0-2s" → 2 · „2–6 s" → 4 · „2-6 Sek." → 4 · „2,5-5s" → 2.5 · „" → null ·
 * „6" → null (einzelne Zahl ist keine Spanne) · „Anfang" → null.
 * Eine Spanne mit Ende ≤ Start ist ebenfalls unbrauchbar → null.
 */
export function parseSceneDuration(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, '-') // en dash / em dash / minus
    .replace(/(\d),(\d)/g, '$1.$2'); // deutsches Dezimalkomma
  const match = normalized.match(
    new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}$`),
  );
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const diff = end - start;
  if (!(diff > 0)) return null;
  return diff;
}

/**
 * „20–30 Sekunden" → 25 (Mittelwert) · „30 Sekunden" → 30 · „20 s" → 20 ·
 * „ca. 25s" → 25 · sonst null.
 */
export function parseLengthSeconds(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/(\d),(\d)/g, '$1.$2');
  const range = normalized.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}`),
  );
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return (a + b) / 2;
  }
  const single = normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}`));
  if (single) {
    const value = Number(single[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

// ── Ganzzahlige Verteilung (größte Reste, §5.2 Schritt 4) ────────────────────

/**
 * Verteilt `total` ganzzahlige Sekunden proportional auf `weights`, Σ = total,
 * jede Position mindestens `min`. Deterministisch: bei Gleichstand gewinnt der
 * kleinere Index.
 */
export function distributeInteger(total: number, weights: number[], min = 1): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const target = Math.max(total, n * min); // Σ kann nicht unter n·min liegen
  const weightSum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const safeWeights = weightSum > 0 ? weights : weights.map(() => 1);
  const safeSum = weightSum > 0 ? weightSum : n;
  const exact = safeWeights.map((w) => (target * (w > 0 ? w : 0)) / safeSum);
  const values = exact.map((v) => Math.floor(v));
  let rest = target - values.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac !== 0 ? b.frac - a.frac : a.i - b.i));
  for (let k = 0; k < rest; k += 1) {
    values[order[k % n].i] += 1;
  }
  // Minimum je Szene sichern — wegnehmen beim jeweils größten Posten.
  for (let i = 0; i < n; i += 1) {
    while (values[i] < min) {
      let donor = -1;
      for (let j = 0; j < n; j += 1) {
        if (values[j] > min && (donor === -1 || values[j] > values[donor])) donor = j;
      }
      if (donor === -1) break; // mathematisch unmöglich, weil target ≥ n·min
      values[donor] -= 1;
      values[i] += 1;
    }
  }
  return values;
}

// ── Gruppierung (§5.2 Schritt 5) ─────────────────────────────────────────────

interface RawClip {
  seconds: number;
  parts: PlannedClipPart[];
}

/** Durchlauf 1: Szenen bleiben GANZ (geteilt wird nur, was nicht in einen Clip passt). */
function groupWholeScenes(sceneSeconds: number[]): { clips: RawClip[]; split: boolean } {
  const clips: RawClip[] = [];
  let current: RawClip = { seconds: 0, parts: [] };
  let split = false;
  const close = () => {
    if (current.seconds > 0) clips.push(current);
    current = { seconds: 0, parts: [] };
  };
  sceneSeconds.forEach((d, sceneIndex) => {
    if (d <= CLIP_MAX_SECONDS) {
      if (current.seconds > 0 && current.seconds + d > CLIP_MAX_SECONDS) close();
      current.parts.push({ sceneIndex, seconds: d, continued: false });
      current.seconds += d;
      if (current.seconds === CLIP_MAX_SECONDS) close();
      return;
    }
    // Szene länger als ein Clip ⇒ an der Clip-Grenze teilen (§5.4).
    split = true;
    let remaining = d;
    let continued = false;
    while (remaining > 0) {
      if (current.seconds > 0) close();
      const take = Math.min(CLIP_MAX_SECONDS, remaining);
      current.parts.push({ sceneIndex, seconds: take, continued });
      current.seconds = take;
      remaining -= take;
      continued = true;
      if (remaining > 0) close();
    }
    close();
  });
  close();
  return { clips, split };
}

/** Durchlauf 2: Szenen dürfen geteilt werden; Verteilung füllt von vorn. */
function groupByTimeWindows(sceneSeconds: number[], target: number): RawClip[] {
  const n = Math.min(MAX_CLIPS, Math.max(1, Math.ceil(target / CLIP_MAX_SECONDS)));
  const sizes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) sizes.push(CLIP_MAX_SECONDS);
  sizes.push(target - CLIP_MAX_SECONDS * (n - 1));
  // Letzter Clip unter dem Anbieter-Minimum? Sekunden von vorn zurückholen.
  let last = sizes.length - 1;
  while (sizes[last] < CLIP_MIN_SECONDS) {
    const donor = sizes.findIndex((s, i) => i < last && s > CLIP_MIN_SECONDS);
    if (donor === -1) break;
    sizes[donor] -= 1;
    sizes[last] += 1;
  }
  // Szenen-Zeitfenster (kumulativ) gegen Clip-Fenster schneiden.
  const sceneStarts: number[] = [];
  let acc = 0;
  for (const d of sceneSeconds) {
    sceneStarts.push(acc);
    acc += d;
  }
  const clips: RawClip[] = [];
  let cursor = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    const start = cursor;
    const end = cursor + sizes[i];
    cursor = end;
    const parts: PlannedClipPart[] = [];
    sceneSeconds.forEach((d, sceneIndex) => {
      const s = sceneStarts[sceneIndex];
      const e = s + d;
      const overlap = Math.min(end, e) - Math.max(start, s);
      if (overlap > 0) {
        parts.push({ sceneIndex, seconds: overlap, continued: s < start });
      }
    });
    clips.push({ seconds: sizes[i], parts });
  }
  return clips;
}

/** Schritt 6: zu kurze Clips zusammenlegen bzw. Sekunden umschichten. */
function fixShortClips(
  clips: RawClip[],
  warnings: VideoPlanWarning[],
): RawClip[] {
  const out = clips.map((c) => ({ seconds: c.seconds, parts: [...c.parts] }));
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].seconds >= CLIP_MIN_SECONDS) continue;
    const prev = i - 1;
    if (prev >= 0 && out[prev].seconds + out[i].seconds <= CLIP_MAX_SECONDS) {
      out[prev].parts.push(...out[i].parts);
      out[prev].seconds += out[i].seconds;
      out.splice(i, 1);
      i -= 1;
      warnings.push({
        code: 'clip_merged',
        message: 'Ein sehr kurzer Clip wurde mit dem vorigen zusammengelegt.',
      });
      continue;
    }
    if (i + 1 < out.length && out[i].seconds + out[i + 1].seconds <= CLIP_MAX_SECONDS) {
      out[i + 1].parts.unshift(...out[i].parts);
      out[i + 1].seconds += out[i].seconds;
      out.splice(i, 1);
      warnings.push({
        code: 'clip_merged',
        message: 'Ein sehr kurzer Clip wurde mit dem nächsten zusammengelegt.',
      });
      i -= 1;
      continue;
    }
    // Nicht zusammenlegbar ⇒ Sekunden vom Nachbarn nehmen (Σ bleibt erhalten).
    const neighbor = prev >= 0 ? prev : i + 1;
    let needed = CLIP_MIN_SECONDS - out[i].seconds;
    while (needed > 0 && out[neighbor] && out[neighbor].seconds > CLIP_MIN_SECONDS) {
      out[neighbor].seconds -= 1;
      out[i].seconds += 1;
      needed -= 1;
    }
    if (needed === 0) {
      warnings.push({
        code: 'clip_rebalanced',
        message: 'Ein kurzer Clip wurde auf das Anbieter-Minimum verlängert.',
      });
    }
  }
  return out;
}

// ── Prompt (§5.6) ────────────────────────────────────────────────────────────

/**
 * Baut den Video-Prompt eines Clips. Deterministisch, ohne LLM.
 * `text` (eingeblendeter Text) geht NICHT ein — Bild-im-Bild-Problem (§5.6).
 */
export function buildClipPrompt(sceneTexts: string[], continuation = false): string {
  const body = sceneTexts
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0)
    .join(' ');
  const parts = [VIDEO_PROMPT_STYLE];
  if (body) parts.push(body);
  if (continuation) parts.push(VIDEO_PROMPT_CONTINUATION);
  parts.push(VIDEO_PROMPT_CONSISTENCY);
  const prompt = parts.join('\n');
  return prompt.length > PROMPT_MAX_CHARS ? prompt.slice(0, PROMPT_MAX_CHARS) : prompt;
}

// ── Ziel-Dauer (§5.2 Schritt 3) ──────────────────────────────────────────────

function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TARGET_SECONDS;
  return Math.min(TARGET_MAX_SECONDS, Math.max(CLIP_MIN_SECONDS, Math.round(value)));
}

function targetFromSource(source: VideoSceneSource): number | null {
  if (typeof source.seconds === 'number' && Number.isFinite(source.seconds) && source.seconds > 0) {
    return clampTarget(source.seconds);
  }
  const fromLength = parseLengthSeconds(source.length);
  if (fromLength !== null) return clampTarget(fromLength);
  return null;
}

// ── Hauptfunktion ────────────────────────────────────────────────────────────

/**
 * Teilt einen TikTok-Szenenplan in 1–3 Anbieter-Clips.
 *
 * Rückgabe `null` NUR, wenn es gar keinen Szenenplan gibt (§5.4: kein Button).
 * Nicht aufteilbare Pläne (unmöglich bei MAX_CLIPS=3 und T ≤ 30) würden
 * ebenfalls `null` liefern — dann mit Warnung `not_splittable` im Log-Pfad.
 */
export function planClips(source: VideoSceneSource): VideoClipPlan | null {
  const warnings: VideoPlanWarning[] = [];

  // 1. Szenenliste bestimmen (timedScenes → scenes[] → nichts)
  const timed = Array.isArray(source.timedScenes)
    ? source.timedScenes.filter(
        (s) => s && typeof s === 'object' && (typeof s.scene === 'string' || typeof s.text === 'string'),
      )
    : [];
  let sceneTexts: string[] = [];
  let sceneTimes: (string | null)[] = [];
  let hasTimedScenes = timed.length > 0;
  if (hasTimedScenes) {
    sceneTexts = timed.map((s) => (typeof s.scene === 'string' ? s.scene : '') || (typeof s.text === 'string' ? s.text : ''));
    sceneTimes = timed.map((s) => (typeof s.time === 'string' ? s.time : null));
  } else {
    const flat = Array.isArray(source.scenes)
      ? source.scenes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    if (flat.length === 0) return null; // §5.4: beides fehlt ⇒ kein Button
    sceneTexts = flat;
    sceneTimes = flat.map(() => null);
    hasTimedScenes = false;
    warnings.push({
      code: 'scenes_fallback',
      message: 'Ohne Zeitmarken — die Dauer wird gleichmäßig geschätzt.',
    });
  }

  const sceneCount = sceneTexts.length;

  // 2. Dauer je Szene
  const parsed = sceneTimes.map((t) => parseSceneDuration(t));
  const parseable = parsed.filter((d): d is number => d !== null);
  const allUnparseable = parseable.length === 0;
  const someUnparseable = parseable.length > 0 && parseable.length < sceneCount;

  let sceneSecondsRaw: number[];
  let target: number;

  if (allUnparseable) {
    // 2d + 3b/3c/3d: Ziel aus seconds/length, sonst 25 — gleichmäßig verteilt.
    const guessed = targetFromSource(source) ?? DEFAULT_TARGET_SECONDS;
    target = guessed;
    sceneSecondsRaw = new Array(sceneCount).fill(guessed / sceneCount);
    warnings.push({
      code: 'durations_estimated',
      message: `Zeitangaben unvollständig — Dauer geschätzt: ${guessed} s.`,
    });
  } else {
    const mean = parseable.reduce((a, b) => a + b, 0) / parseable.length;
    sceneSecondsRaw = parsed.map((d) => (d === null ? mean : d));
    if (someUnparseable) {
      warnings.push({
        code: 'durations_estimated',
        message: 'Zeitangaben unvollständig — fehlende Szenen mit dem Mittelwert geschätzt.',
      });
    }
    const sum = sceneSecondsRaw.reduce((a, b) => a + b, 0);
    // 3a: timedScenes ⇒ T = clamp(D, 3, 30) — NICHT auf 20 hochziehen.
    target = clampTarget(sum);
    if (sum > TARGET_MAX_SECONDS) {
      warnings.push({
        code: 'condensed_to_30',
        message: `Dein Plan ist ${Math.round(sum)} s lang; das Video wird auf 30 s gestrafft — alle Szenen bleiben, aber kürzer.`,
      });
    }
  }

  // Szenenzahl kann T unterlaufen (jede Szene mindestens 1 s).
  if (target < sceneCount) {
    target = Math.min(TARGET_MAX_SECONDS, sceneCount);
    warnings.push({
      code: 'target_raised_for_scene_count',
      message: 'Sehr kurze Szenen — die Gesamtdauer wurde auf eine Sekunde je Szene angehoben.',
    });
  }
  if (target < TARGET_MIN_SECONDS) {
    warnings.push({
      code: 'shorter_than_target',
      message: `Dein Szenenplan ergibt ${target} Sekunden — das Video wird ${target} s lang, nicht 20–30 s.`,
    });
  }

  // 4. Ganzzahlige Verteilung, Σ = target
  const sceneSeconds = distributeInteger(target, sceneSecondsRaw);

  // 5. Gruppieren — Durchlauf 1, sonst Durchlauf 2
  const pass1 = groupWholeScenes(sceneSeconds);
  let rawClips: RawClip[];
  if (pass1.clips.length <= MAX_CLIPS) {
    rawClips = pass1.clips;
    if (pass1.split) {
      warnings.push({
        code: 'scene_split',
        message: 'Eine lange Szene wurde an der Clip-Grenze geteilt (gleicher Szenentext).',
      });
    }
  } else {
    rawClips = groupByTimeWindows(sceneSeconds, target);
  }

  // 6. Zu kurze Clips behandeln
  rawClips = fixShortClips(rawClips, warnings);

  if (rawClips.length === 0 || rawClips.length > MAX_CLIPS) return null;

  // 7. Prompt je Clip aus den Szenentexten, die den Clip berühren
  const clips: PlannedClip[] = rawClips.map((c, index) => {
    const texts: string[] = [];
    for (const part of c.parts) {
      const text = sceneTexts[part.sceneIndex] ?? '';
      if (text && texts[texts.length - 1] !== text) texts.push(text);
    }
    const continued = c.parts.some((p) => p.continued);
    return { index, seconds: c.seconds, parts: c.parts, prompt: buildClipPrompt(texts, continued) };
  });

  return {
    clips,
    secondsTotal: clips.reduce((a, c) => a + c.seconds, 0),
    sceneCount,
    targetSeconds: target,
    estimated: allUnparseable,
    warnings,
  };
}

/**
 * Bequemer Einstieg für das TikTok-Konzept (`TikTokIdeaResult`): nutzt
 * `timedScenes`, sonst `scenes[]` + `length` (§5.1).
 */
export function planClipsFromTikTokConcept(result: {
  timedScenes?: { time?: string | null; scene?: string | null; text?: string | null }[] | null;
  scenes?: string[] | null;
  length?: string | null;
} | null | undefined): VideoClipPlan | null {
  if (!result) return null;
  return planClips({
    timedScenes: result.timedScenes ?? null,
    scenes: result.scenes ?? null,
    length: result.length ?? null,
  });
}

/**
 * Bequemer Einstieg für die TikTok-Diagnose v2 (`rebuilt`): `timedScenes` +
 * `seconds` (§5.1).
 */
export function planClipsFromTikTokRebuilt(rebuilt: {
  timedScenes?: { time?: string | null; scene?: string | null; text?: string | null }[] | null;
  seconds?: number | null;
} | null | undefined): VideoClipPlan | null {
  if (!rebuilt) return null;
  return planClips({
    timedScenes: rebuilt.timedScenes ?? null,
    seconds: typeof rebuilt.seconds === 'number' ? rebuilt.seconds : null,
  });
}

/**
 * Stabilisierung Phase 4.3 — „Zuletzt erstellt" der TikTok-Werkstatt
 * (Ergebnisse & Projekte behalten, Wiederöffnen).
 *
 * Aufbau auf der Phase-3-Persistenz (`~/lib/last-result`): dort liegt das
 * ZULETZT erzeugte Ergebnis unter `growimo_tiktok_last_result` (Version 1, TTL
 * 12 h) und wird für den Bild-Studio-Prefill genutzt. Phase 4.3 ergänzt eine
 * versionierte LISTE (max. 3) bereits erzeugter Ergebnisse:
 *
 *  1. Jede erfolgreiche Generierung wandert an Position 0 der Liste; die Liste
 *     ist auf `TIKTOK_RECENT_MAX` (3) gekappt.
 *  2. Jeder Eintrag ist über die UI wieder ÖFFENBAR — das gespeicherte Ergebnis
 *     wird gerendert, ohne neue Generierung (0 Verbrauch).
 *  3. Jeder Eintrag hat einen „In Projekt speichern"-Button, der den
 *     vorhandenen `saveProject`-Weg (`~/store/projects`) nutzt — KEIN
 *     DB-Schema-Eingriff, KEIN ContentType-Eingriff.
 *
 * Speicherformat (sessionStorage, bewusst KISS wie Phase 3 — keine DB):
 *   `TIKTOK_RECENT_KEY` = JSON-Array von `TikTokRecentEntry`.
 *   JEDER Eintrag trägt sein eigenes `version`-Feld. Einträge ohne/mit fremder
 *   Version werden beim Lesen IGNORIERT (nicht interpretiert) — dadurch kann
 *   eine künftige Formatänderung alte Einträge nie crashen.
 *
 * Entschiedene Migrations-Frage (Fix-Plan §4.3: „alte Einträge ohne Version
 * ignorieren oder migrieren"):
 *  - Innerhalb der Liste: IGNORIEREN (ein Eintrag ohne `version === 1` wird
 *    verworfen) — fail-closed, keine Interpretation unbekannter Daten.
 *  - Das Phase-3-EINZELergebnis (`growimo_tiktok_last_result`) dagegen wird
 *    EINMALIG migriert: ist die Liste leer und existiert ein gültiges
 *    Einzelergebnis, wird es als Listeneintrag übernommen (und die Liste
 *    geschrieben). So zeigt die Werkstatt den bereits sichtbaren Stand nach
 *    dem Update auch in „Zuletzt erstellt" — ohne Duplikat, ohne Datenverlust.
 *    Der alte Schlüssel bleibt unangetastet (Phase-3-/Studio-Prefill-Verhalten).
 *
 * ZAHL-SEMANTIK (Phase 8.2 — Usage):
 *  Wiederöffnen und „In Projekt speichern" rufen KEINEN KI-Pfad auf:
 *  kein `generateTikTokServer`, also kein `withGenerationGuard` und kein
 *  Konditional-Increment in `usage_monthly`. Wiederöffnen liest ausschließlich
 *  sessionStorage, Speichern schreibt ausschließlich nach Postgres
 *  (`qSaveProject`). Eine Generierung wird nur durch eine echte Generierung
 *  verbraucht (1 fertiges Ergebnis = 1 Generierung).
 */
import type {
  TikTokDiagnoseDataGapResult,
  TikTokDiagnoseResult,
  TikTokIdeaResult,
  TikTokMode,
  TikTokResult,
} from '~/ai/tiktok';
import type { ContentType } from '~/ai/types';
import type { Translations } from '~/i18n';
// Relativer Import (statt `~/lib/last-result`): dieses Modul wird auch in den
// Bun-Testharnessen direkt importiert — ein Wert-Import über den Vite-Alias
// wäre dort nicht auflösbar.
import { TIKTOK_RESULT_TTL_MS, readTikTokResult } from './last-result';

/** sessionStorage-Schlüssel der „Zuletzt erstellt"-Liste. */
export const TIKTOK_RECENT_KEY = 'growimo_tiktok_recent_results';
/** Format-Version je Listeneintrag (Einträge anderer Version werden ignoriert). */
export const TIKTOK_RECENT_VERSION = 1;
/** Kappung der Liste (Fix-Plan §4.3: max. 3 Einträge). */
export const TIKTOK_RECENT_MAX = 3;
/** TTL wie Phase 3 (12 h) — zusätzlich zur ohnehin flüchtigen Session. */
export const TIKTOK_RECENT_TTL_MS = TIKTOK_RESULT_TTL_MS;
/** Maximale Länge der deterministischen Beschriftung eines Eintrags. */
export const TIKTOK_RECENT_LABEL_MAX = 80;

/**
 * ContentType des gespeicherten TikTok-Assets.
 *
 * Bewusst `social_post` — TikTok IST ein Social-Kanal. Der ContentType-Union
 * (`~/ai/types`) wird in Phase 4 ABSICHTLICH nicht um TikTok erweitert (Fix-Plan
 * §4.3: „kein ContentType-Eingriff"; eine Erweiterung ist Backlog, weil sie
 * Projekt-/Library-/Analyse-Pfade berührt). Die Herkunft wird deshalb im
 * Asset-Metadata (`source: 'tiktok'`) festgehalten.
 */
export const TIKTOK_RECENT_CONTENT_TYPE: ContentType = 'social_post';

/** Ein Eintrag der „Zuletzt erstellt"-Liste (versioniert, selbsttragend). */
export interface TikTokRecentEntry {
  version: number;
  /** Deterministische ID (Modus + Beschriftung) — Grundlage der Deduplizierung. */
  id: string;
  mode: TikTokMode;
  result: TikTokResult;
  savedAt: number;
  /** Kurze, deterministisch abgeleitete Beschriftung (kein LLM, keine Erfindung). */
  label: string;
  /** Produkt-/Themenbezug der Generierung (kann leer sein — dann nutzt das
   *  Projekt die Beschriftung; es wird nie etwas erfunden). */
  productIdea: string;
}

const MODES: TikTokMode[] = ['todayIdea', 'concept', 'diagnose'];

/** Deterministischer 32-Bit-Hash (FNV-1a) — reicht für Listeneintrags-IDs. */
function hash32(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '');
  return line ?? '';
}

/** Kürzt eine Beschriftung auf `TIKTOK_RECENT_LABEL_MAX` Zeichen (mit „…"). */
export function truncateRecentLabel(text: string): string {
  const clean = firstLine(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= TIKTOK_RECENT_LABEL_MAX) return clean;
  return clean.slice(0, TIKTOK_RECENT_LABEL_MAX - 1).trimEnd() + '…';
}

/**
 * Deterministische Beschriftung eines Ergebnisses für die Liste (reine
 * Funktion): NUR Text aus dem Ergebnis selbst — kein LLM, keine Erfindung.
 */
export function recentEntryLabel(mode: TikTokMode, result: TikTokResult): string {
  if (mode === 'diagnose') {
    const d = result as TikTokDiagnoseResult | TikTokDiagnoseDataGapResult;
    const text = d.dataGap === true ? d.note : d.biggestProblem;
    const label = truncateRecentLabel(text ?? '');
    if (label) return label;
  } else {
    const r = result as TikTokIdeaResult;
    const label = truncateRecentLabel(r.idea || '') || truncateRecentLabel(r.hook || '');
    if (label) return label;
  }
  return 'TikTok';
}

/** Deterministische Eintrags-ID: gleicher Modus + gleiche Beschriftung = gleicher Eintrag. */
export function recentEntryId(mode: TikTokMode, result: TikTokResult): string {
  return `${mode}:${hash32(recentEntryLabel(mode, result))}`;
}

/** Baut einen versionierten Listeneintrag (reine Funktion, testbar). */
export function createRecentEntry(
  mode: TikTokMode,
  result: TikTokResult,
  productIdea: string = '',
  now: number = Date.now(),
): TikTokRecentEntry {
  return {
    version: TIKTOK_RECENT_VERSION,
    id: recentEntryId(mode, result),
    mode,
    result,
    savedAt: now,
    label: recentEntryLabel(mode, result),
    productIdea: productIdea.trim(),
  };
}

/**
 * Fügt einen Eintrag an Position 0 ein, entfernt ein vorhandenes Duplikat
 * (gleiche ID) und kappt die Liste auf `max` (Default 3). Reine Funktion.
 */
export function addRecentEntry(
  list: readonly TikTokRecentEntry[],
  entry: TikTokRecentEntry,
  max: number = TIKTOK_RECENT_MAX,
): TikTokRecentEntry[] {
  const rest = list.filter((e) => e.id !== entry.id);
  return [entry, ...rest].slice(0, Math.max(1, max));
}

/** Serialisiert die Liste (JSON-Array, jeder Eintrag trägt sein Versionsfeld). */
export function serializeRecentList(list: readonly TikTokRecentEntry[]): string {
  return JSON.stringify(list);
}

/**
 * Validiert eine gespeicherte Liste Element für Element und gibt nur die
 * brauchbaren Einträge zurück (Version stimmt, Modus bekannt, Zeitstempel
 * endlich, Ergebnis vorhanden, TTL nicht abgelaufen). Einträge OHNE Versionsfeld
 * werden verworfen. Duplikate (gleiche ID) werden entfernt, die Liste wird auf
 * `max` gekappt. Reine Funktion.
 */
export function parseRecentList(
  raw: string | null,
  now: number = Date.now(),
  ttlMs: number = TIKTOK_RECENT_TTL_MS,
  max: number = TIKTOK_RECENT_MAX,
): TikTokRecentEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TikTokRecentEntry[] = [];
  for (const item of parsed) {
    const e = item as Partial<TikTokRecentEntry> | null;
    if (!e || typeof e !== 'object') continue;
    // Alte/ fremde Einträge: kein Versionsfeld oder andere Version → ignorieren.
    if (e.version !== TIKTOK_RECENT_VERSION) continue;
    if (typeof e.mode !== 'string' || !MODES.includes(e.mode as TikTokMode)) continue;
    if (typeof e.savedAt !== 'number' || !Number.isFinite(e.savedAt)) continue;
    if (Number.isFinite(ttlMs) && ttlMs > 0 && now - e.savedAt > ttlMs) continue;
    const result = e.result as TikTokResult | undefined;
    if (!result || typeof result !== 'object') continue;
    if (typeof (result as { mode?: unknown }).mode !== 'string') continue;
    const label = typeof e.label === 'string' && e.label.trim() !== ''
      ? e.label
      : recentEntryLabel(e.mode as TikTokMode, result);
    const entry: TikTokRecentEntry = {
      version: TIKTOK_RECENT_VERSION,
      id: typeof e.id === 'string' && e.id.trim() !== ''
        ? e.id
        : recentEntryId(e.mode as TikTokMode, result),
      mode: e.mode as TikTokMode,
      result,
      savedAt: e.savedAt,
      label,
      productIdea: typeof e.productIdea === 'string' ? e.productIdea : '',
    };
    if (out.some((x) => x.id === entry.id)) continue; // Duplikat (neuerer Eintrag gewinnt)
    out.push(entry);
    if (out.length >= Math.max(1, max)) break;
  }
  return out;
}

/** Schreibt die Liste (nie blockierend — Privacy-Modus darf nichts kaputtmachen). */
export function writeRecentList(list: readonly TikTokRecentEntry[]): void {
  try {
    sessionStorage.setItem(TIKTOK_RECENT_KEY, serializeRecentList(list));
  } catch {
    /* sessionStorage nicht verfügbar — Liste bleibt im React-State */
  }
}

/** Liest die geschützte Liste (mit TTL/Version/Duplikat-Prüfung). */
export function readRawRecentList(now: number = Date.now()): TikTokRecentEntry[] {
  try {
    return parseRecentList(sessionStorage.getItem(TIKTOK_RECENT_KEY), now);
  } catch {
    return [];
  }
}

/**
 * Liest die „Zuletzt erstellt"-Liste und migriert EINMALIG das Phase-3-
 * Einzelergebnis, falls die Liste (noch) leer ist (s. Modulkopf). Schreibt die
 * migrierte Liste zurück; der Phase-3-Schlüssel bleibt unangetastet.
 */
export function readRecentList(now: number = Date.now()): TikTokRecentEntry[] {
  const stored = readRawRecentList(now);
  if (stored.length > 0) return stored;
  let legacySavedAt = now;
  let legacyProductIdea = '';
  try {
    const raw = sessionStorage.getItem('growimo_tiktok_last_result');
    if (raw) {
      const parsed = JSON.parse(raw) as { savedAt?: unknown };
      if (typeof parsed?.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
        legacySavedAt = parsed.savedAt;
      }
    }
  } catch {
    /* defekter Alt-Eintrag → Zeitstempel bleibt `now` */
  }
  const legacy = readTikTokResult(now);
  if (!legacy) return [];
  const migrated = [createRecentEntry(legacy.mode, legacy.result, legacyProductIdea, legacySavedAt)];
  writeRecentList(migrated);
  return migrated;
}

/**
 * Nimmt ein frisch erzeugtes Ergebnis in die Liste auf (Position 0, Kappung auf
 * 3) und schreibt sie. Liest dafür den aktuellen Stand aus dem sessionStorage —
 * dadurch bleiben nebenläufige Änderungen (zweiter Tab) erhalten und es gibt
 * keinen veralteten React-Closure-Stand. Gibt die neue Liste zurück.
 */
export function pushRecentResult(
  mode: TikTokMode,
  result: TikTokResult,
  productIdea: string = '',
  now: number = Date.now(),
): TikTokRecentEntry[] {
  const next = addRecentEntry(
    readRawRecentList(now),
    createRecentEntry(mode, result, productIdea, now),
  );
  writeRecentList(next);
  return next;
}

/** Leert die Liste (bewusster Aufräum-Klick; „Neue Idee" leert sie NICHT,
 *  weil die Phase-4.3-Anforderung lautet: Ergebnisse behalten). */
export function clearRecentList(): void {
  try {
    sessionStorage.removeItem(TIKTOK_RECENT_KEY);
  } catch {
    /* sessionStorage nicht verfügbar */
  }
}

// ── Serialisierung des Ergebnisses in lesbaren Text (Asset-Body) ───────────────

/**
 * Formatiert ein TikTok-Ergebnis deterministisch als lesbaren Text für das
 * gespeicherte Projekt-Asset. Nutzt ausschließlich vorhandene i18n-Überschriften
 * (`t.tiktok_result_*`) und die Werte des Ergebnisses — keine Erfindung, keine
 * Umformulierung. Reine Funktion (Übersetzungsobjekt wird übergeben).
 */
export function formatTikTokResultText(result: TikTokResult, t: Translations): string {
  const blocks: string[] = [];
  const section = (heading: string, body: string) => {
    if (body.trim() === '') return;
    blocks.push(`## ${heading}\n${body.trim()}`);
  };
  if (result.mode === 'diagnose') {
    const d = result as TikTokDiagnoseResult | TikTokDiagnoseDataGapResult;
    if (d.dataGap === true) {
      section(t.tiktok_data_gap_title, d.note);
      section(
        t.tiktok_data_gap_missing,
        d.missingMetrics
          .map((k) =>
            k === 'views'
              ? t.tiktok_metrics_views
              : k === 'length'
                ? t.tiktok_metrics_length
                : t.tiktok_metrics_avgwatch,
          )
          .map((l) => `- ${l}`)
          .join('\n'),
      );
      section(t.tiktok_result_cta, d.cta);
      return blocks.join('\n\n');
    }
    section(t.tiktok_result_biggest, d.biggestProblem);
    section(t.tiktok_result_works, d.whatWorks.map((w) => `- ${w}`).join('\n'));
    section(t.tiktok_result_improve, d.whatToImprove.map((w) => `- ${w}`).join('\n'));
    section(t.tiktok_result_newhook, d.newHook);
    section(t.tiktok_result_optimized, d.optimized);
    if (d.rebuilt) {
      section(t.tiktok_result_rebuilt, d.rebuilt.hook);
      section(
        t.tiktok_result_timed_scenes,
        d.rebuilt.timedScenes
          .map((s) => `- ${s.time}: ${s.scene}${s.text.trim() ? ` (${s.text})` : ''}`)
          .join('\n'),
      );
      section(t.tiktok_result_rebuilt_voiceover, d.rebuilt.voiceover);
      section(t.tiktok_result_cta, d.rebuilt.cta);
      section(
        t.tiktok_result_length_recommendation,
        t.tiktok_result_rebuilt_seconds.replace('%s', String(d.rebuilt.seconds)),
      );
    }
    if (d.lengthRecommendation) {
      section(
        t.tiktok_result_length_recommendation,
        [
          t.tiktok_result_length_seconds.replace('%s', String(d.lengthRecommendation.seconds)),
          d.lengthRecommendation.structure,
          d.lengthRecommendation.reason,
        ]
          .filter((x) => x && x.trim() !== '')
          .join('\n'),
      );
    }
    section(t.tiktok_result_nexttest, d.nextTest);
    return blocks.join('\n\n');
  }
  const r = result as TikTokIdeaResult;
  section(t.tiktok_result_idea, r.idea);
  section(t.tiktok_result_hook, r.hook);
  section(t.tiktok_result_scroll_stop, r.scrollStop ?? '');
  section(t.tiktok_result_length, r.length);
  section(t.tiktok_result_format, r.format ?? '');
  section(t.tiktok_result_title, r.title ?? '');
  if (r.timedScenes && r.timedScenes.length > 0) {
    section(
      t.tiktok_result_timed_scenes,
      r.timedScenes
        .map((s) => `- ${s.time}: ${s.scene}${s.text.trim() ? ` (${s.text})` : ''}`)
        .join('\n'),
    );
  }
  section(t.tiktok_result_scenes, r.scenes.map((s) => `- ${s}`).join('\n'));
  section(t.tiktok_result_overlays, r.overlays.map((o) => `- ${o}`).join('\n'));
  section(t.tiktok_result_spoken, r.spokenText);
  section(t.tiktok_result_tension, r.tension ?? '');
  section(t.tiktok_result_caption, r.caption);
  section(t.tiktok_result_hashtags, r.hashtags.join(' '));
  section(t.tiktok_result_cta, r.cta);
  section(t.tiktok_result_why, r.why);
  if (r.imageIdeas && r.imageIdeas.length > 0) {
    section(
      t.tiktok_result_image_ideas,
      r.imageIdeas
        .map((i) => `- ${i.description}\n  ${t.tiktok_result_studio_prompt}: ${i.studioPrompt}`)
        .join('\n'),
    );
  }
  return blocks.join('\n\n');
}

// ── „In Projekt speichern" — Argumente des vorhandenen saveProject-Wegs ────────

/** Projekt-/Content-Argumente für `saveProject(userId, project, contents)`. */
export interface TikTokProjectSaveArgs {
  project: {
    userId: string;
    title: string;
    productIdea: string;
    contentTypes: ContentType[];
    status: 'completed';
  };
  contents: Array<{
    contentType: ContentType;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
  }>;
}

/** Projekt-Titel wie im bestehenden Muster (QuickGenerator.tsx): erste 50 Zeichen. */
export function recentProjectTitle(text: string): string {
  return text.length > 50 ? text.slice(0, 50) + '...' : text;
}

/**
 * Baut die Argumente für den vorhandenen `saveProject`-Weg (reine Funktion).
 * Der Nutzer behält das Ergebnis damit in der Content-Library — OHNE neue
 * Generierung (Zähl-Semantik s. Modulkopf) und OHNE Schema-/ContentType-Änderung.
 */
export function buildTikTokSaveArgs(
  entry: TikTokRecentEntry,
  userId: string,
  t: Translations,
): TikTokProjectSaveArgs {
  const source = entry.productIdea.trim() || entry.label;
  return {
    project: {
      userId,
      title: recentProjectTitle(source),
      productIdea: source,
      contentTypes: [TIKTOK_RECENT_CONTENT_TYPE],
      status: 'completed',
    },
    contents: [
      {
        contentType: TIKTOK_RECENT_CONTENT_TYPE,
        title: entry.label,
        body: formatTikTokResultText(entry.result, t),
        metadata: {
          source: 'tiktok',
          tiktokMode: entry.mode,
          tiktokEntryId: entry.id,
          tiktokCreatedAt: entry.savedAt,
        },
      },
    ],
  };
}

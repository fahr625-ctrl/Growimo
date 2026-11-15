// ─────────────────────────────────────────────────────────────────────────────
// Etsy-Listing: ERST speichern, DANN buchen (Owner-Entscheidung 2026-11-14)
// ─────────────────────────────────────────────────────────────────────────────
// Ausgangsbefund: Lauf des Owners am 14.11. 16:01 UTC — `generateContentServer`
// lief vollständig durch (Score 70), die Antwort erreichte das Handy nie. Das
// Ergebnis war weg, für ein Normalkonto wäre die Einheit trotzdem abgebucht
// worden (der Guard bucht bei Erfolg des KI-Calls).
//
// Neue, verbindliche Reihenfolge für den Etsy-Pfad:
//   1. Auftrag wiedererkennen (Idempotenz) → vorhandenes Listing zurückgeben,
//      kein neuer Datensatz, `usage` unverändert.
//   2. KI-Call (ohne Buchung).
//   3. Listing nutzbar? (Titel, Beschreibung, genau 13 gültige Tags)
//   4. serverseitig in die Inhaltsbibliothek schreiben (projects +
//      generated_content — derselbe Weg wie „In Projekt speichern").
//   5. per Leseabfrage prüfen, dass der Datensatz wieder lesbar ist.
//   6. ERST JETZT genau eine Einheit buchen.
// Scheitert 3/4/5 → Fehler melden, 0 Einheiten (es wurde nie gebucht).
//
// Diese Datei läuft ausschließlich serverseitig (DB + OpenAI) und wird von
// `src/ai/server.ts` LAZY importiert, damit nichts davon im Client-Bundle landet.
import { createHash } from 'node:crypto';
import type { ContentRequest, ContentResult, ContentScore } from '~/ai/types';
import { areEtsyTagsUsable, ETSY_TAG_COUNT, ETSY_TAG_MAX_CHARS } from '~/lib/etsy-tags';

/** Zeitfenster, in dem ein erneuter Aufruf als DERSELBE Auftrag gilt. */
export const ETSY_RUN_WINDOW_MS = 10 * 60 * 1000;

/** Projektname einer Einzelgenerierung (wie `quickProjectTitle` im Client). */
const PROJECT_TITLE_MAX = 60;

export class EtsyListingNotUsableError extends Error {
  readonly code = 'ETSY_LISTING_NOT_USABLE';
  constructor(reason: string) {
    super(`Das Etsy-Listing ist nicht verwendbar (${reason}). Es wurde keine Einheit abgezogen.`);
    this.name = 'EtsyListingNotUsableError';
  }
}

export class EtsyListingNotStoredError extends Error {
  readonly code = 'ETSY_LISTING_NOT_STORED';
  constructor(reason: string) {
    super(`Das Etsy-Listing konnte nicht in der Inhaltsbibliothek gespeichert werden (${reason}). Es wurde keine Einheit abgezogen.`);
    this.name = 'EtsyListingNotStoredError';
  }
}

/**
 * Fingerabdruck des Auftrags: Konto + Content-Type + Produktidee + Tonalität.
 *
 * Bewusst OHNE `additionalContext`: der Zusatzkontext wird beim Aufruf aus
 * Markenprofil, Strategie-Brief, Performance- und Lernkontext zusammengesetzt
 * und kann sich zwischen zwei Versuchen allein durch den ersten Lauf ändern.
 * Ein Auftrag ist es aber, wenn Konto, Kanal, Idee und Tonalität gleich sind.
 */
export function etsyRunFingerprint(userId: string, request: ContentRequest): string {
  const norm = (v: string | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const material = [
    userId,
    String(request.contentType),
    norm(request.productIdea),
    norm(request.tone),
  ].join('\u0000');
  return createHash('sha256').update(material).digest('hex');
}

function projectTitle(productIdea: string): string {
  const idea = (productIdea ?? '').replace(/\s+/g, ' ').trim();
  const base = idea ? `Etsy-Listing: ${idea}` : 'Etsy-Listing';
  return base.length <= PROJECT_TITLE_MAX ? base : `${base.slice(0, PROJECT_TITLE_MAX - 3).trimEnd()}...`;
}

/** Nutzbar = Titel und Beschreibung gefüllt und genau 13 gültige Tags. */
export function checkEtsyListingUsable(result: ContentResult): { ok: true; tags: string[] } | { ok: false; reason: string } {
  const title = (result.title ?? '').trim();
  const body = (result.body ?? '').trim();
  if (!title) return { ok: false, reason: 'Titel leer' };
  if (!body) return { ok: false, reason: 'Beschreibung leer' };
  const tags = result.metadata?.tags;
  if (!areEtsyTagsUsable(tags)) {
    const count = Array.isArray(tags) ? tags.length : 0;
    return { ok: false, reason: `Tags unvollständig (${count} von ${ETSY_TAG_COUNT}, max. ${ETSY_TAG_MAX_CHARS} Zeichen)` };
  }
  return { ok: true, tags };
}

function resultFromStored(content: {
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}): ContentResult {
  const meta = { ...(content.metadata ?? {}) } as Record<string, unknown>;
  const score = (meta.score ?? null) as ContentScore | null;
  delete meta.score;
  return {
    contentType: 'etsy_listing',
    title: content.title,
    body: content.body,
    metadata: meta,
    score,
  };
}

export interface EtsyPersistFirstInput {
  /** Clerk-UserId (verifizierte Session — nie aus dem Request-Body). */
  userId: string;
  request: ContentRequest;
  /** Lauf-Schlüssel des Clients (überlebt den Reload); optional. */
  runKey?: string | null;
  lang?: 'de' | 'en';
}

export interface EtsyPersistFirstOutcome {
  result: ContentResult;
  /** Projekt (Inhaltsbibliothek), in dem das Listing liegt. */
  projectId: string;
  /** true = vorhandenes Listing desselben Auftrags zurückgegeben, 0 Einheiten. */
  reused: boolean;
  /** true = genau eine Einheit wurde in diesem Aufruf gebucht. */
  booked: boolean;
}

/**
 * Der Etsy-Pfad des Einzel-Generators. Reihenfolge siehe Dateikopf.
 * Wirft bei nicht nutzbarem/nicht gespeichertem Listing — dann wurde nichts
 * gebucht (fail-closed, 0 Einheiten).
 */
export async function generateEtsyListingPersistFirst(
  input: EtsyPersistFirstInput,
): Promise<EtsyPersistFirstOutcome> {
  const { userId, request } = input;
  const lang = input.lang ?? 'de';
  const runKey = input.runKey?.trim() || null;
  const fingerprint = etsyRunFingerprint(userId, request);

  const queries = await import('~/db/queries');
  const guard = await import('~/lib/usage-guard');

  // 1 — Idempotenz: derselbe Auftrag schon gespeichert?
  const existing = await queries.qFindEtsyLibraryRun(userId, runKey, fingerprint, ETSY_RUN_WINDOW_MS);
  if (existing) {
    const candidate = resultFromStored(existing);
    const usable = checkEtsyListingUsable(candidate);
    if (usable.ok) {
      console.log('[etsy-library] vorhandenes Listing wiederverwendet (keine neue Einheit):', existing.id);
      return {
        result: {
          ...candidate,
          metadata: {
            ...(candidate.metadata ?? {}),
            libraryProjectId: existing.projectId,
            libraryContentId: existing.id,
            libraryReused: true,
          },
        },
        projectId: existing.projectId,
        reused: true,
        booked: false,
      };
    }
    console.log('[etsy-library] vorhandener Datensatz nicht nutzbar, wird neu erzeugt:', existing.id);
  }

  // Kontingent VOR dem KI-Call prüfen (verbraucht nichts, fail-closed am Limit).
  await guard.assertCanGenerate(userId, lang);

  // 2 — KI-Call ohne Buchung.
  const { generateContent } = await import('~/ai/generate');
  let generated: ContentResult;
  try {
    generated = await generateContent({ ...request, enforceFacts: true });
  } catch (err) {
    // Fehlversuch bleibt als Fehlversuch dokumentiert (kein Verbrauch gebucht).
    await guard.logGenerationFailure(userId, err, { action: 'generate_content', detail: 'etsy_listing' });
    throw err;
  }

  // 3 — Nutzbar?
  const usable = checkEtsyListingUsable(generated);
  if (!usable.ok) throw new EtsyListingNotUsableError(usable.reason);

  // 4 — Speichern (derselbe Weg wie „In Projekt speichern").
  let savedProjectId: string;
  let savedContentId: string;
  try {
    const saved = await queries.qSaveProject(
      userId,
      {
        title: projectTitle(request.productIdea),
        productIdea: request.productIdea,
        contentTypes: ['etsy_listing'],
        status: 'completed',
        metadata: {
          runKey,
          runFingerprint: fingerprint,
          savedBy: 'etsy_server_first',
          savedAt: new Date().toISOString(),
        },
      },
      [
        {
          contentType: 'etsy_listing',
          title: generated.title,
          body: generated.body,
          metadata: { ...(generated.metadata ?? {}), score: generated.score ?? undefined },
        },
      ],
    );
    savedProjectId = saved.project.id;
    savedContentId = saved.contents[0]?.id ?? '';
  } catch (err) {
    console.error('[etsy-library] Speichern fehlgeschlagen:', err);
    throw new EtsyListingNotStoredError(err instanceof Error ? err.message.slice(0, 120) : 'unbekannt');
  }
  if (!savedProjectId || !savedContentId) throw new EtsyListingNotStoredError('keine Datensatz-ID');

  // 5 — Leseabfrage: ist das Listing wirklich wieder lesbar?
  let readBack: Awaited<ReturnType<typeof queries.qGetProjectContent>> = [];
  try {
    readBack = await queries.qGetProjectContent(savedProjectId);
  } catch (err) {
    throw new EtsyListingNotStoredError(err instanceof Error ? err.message.slice(0, 120) : 'Leseabfrage fehlgeschlagen');
  }
  const stored = readBack.find((c) => c.id === savedContentId && c.contentType === 'etsy_listing');
  if (!stored) throw new EtsyListingNotStoredError('Leseabfrage fand den Datensatz nicht');
  const readBackUsable = checkEtsyListingUsable(resultFromStored(stored));
  if (!readBackUsable.ok) throw new EtsyListingNotStoredError(`gespeichertes Listing nicht nutzbar: ${readBackUsable.reason}`);

  // 6 — ERST JETZT genau eine Einheit buchen.
  const booked = await guard.recordGeneration(userId, lang, {
    action: 'generate_content',
    detail: 'etsy_listing',
    contentId: savedContentId,
  });
  console.log('[etsy-library] Listing gespeichert und gelesen, 1 Einheit gebucht:', savedProjectId, 'used=', booked.used);

  return {
    result: {
      ...generated,
      metadata: {
        ...(generated.metadata ?? {}),
        libraryProjectId: savedProjectId,
        libraryContentId: savedContentId,
      },
    },
    projectId: savedProjectId,
    reused: false,
    booked: true,
  };
}

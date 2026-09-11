// ── TikTok Phase 4: Projekt-Kontext-Baustein (lesend, UI-seitig) ─────────────
// Das TikTok-Modul liest die jüngsten PostgreSQL-Projekte (title, productIdea,
// metadata.brief = F6-Strategie-Brief) und schickt daraus einen kompakten
// `projectContext`-Block an die Engine. Dieser Baustein ist eine REINE Funktion:
// er extrahiert ausschließlich vorhandene Felder (nie erfinden) und rendert den
// Brief mit dem vorhandenen buildBriefContext()-Mechanismus (F6, nur lesend).
// Keine Schreiboperationen an Projekten — ausschließlich lesende Nutzung.
import { buildBriefContext, type BriefLang } from '../ai/strategy-brief/questions';
import type { TikTokProjectContext } from '../ai/tiktok';

/** Minimaler Projekt-Subtyp — kompatibel zu `Project` aus ~/store/projects
 *  (nur die Felder, die der TikTok-Flow liest). Keep loose: null-/undefined-sicher. */
export interface TikTokProjectLite {
  id?: string;
  title?: string | null;
  productIdea?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Extrahiert den F6-Strategie-Brief als Text. Nimmt NUR vorhandene
 *  String-Werte auf (nie erfinden); leere/unpassende Einträge werden verworfen.
 *  Kein Brief → undefined (Flow verhält sich wie ohne Brief). */
export function extractBriefText(
  briefRaw: unknown,
  lang: BriefLang = 'de',
): string | undefined {
  if (!briefRaw || typeof briefRaw !== 'object' || Array.isArray(briefRaw)) return undefined;
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(briefRaw)) {
    if (typeof value === 'string' && value.trim()) record[key] = value.trim();
  }
  if (Object.keys(record).length === 0) return undefined;
  return buildBriefContext(record, lang) || undefined;
}

/** Baut den optionalen `projectContext`-Payload für die TikTok-Engine aus einem
 *  gewählten Projekt. Nur vorhandene Felder (title/productIdea/brief) werden
 *  übernommen; fehlt alles → undefined (Flow wie bisher, kein Projekt-Kontext). */
export function buildTikTokProjectContext(
  project: TikTokProjectLite | null | undefined,
  lang: BriefLang = 'de',
): TikTokProjectContext | undefined {
  if (!project) return undefined;
  const title = project.title && project.title.trim() ? project.title.trim() : undefined;
  const productIdea =
    project.productIdea && project.productIdea.trim() ? project.productIdea.trim() : undefined;
  const brief = extractBriefText(project.metadata?.brief, lang);
  const projectId = project.id && project.id.trim() ? project.id.trim() : undefined;
  if (!title && !productIdea && !brief) return undefined;
  return { projectId, title, productIdea, brief };
}
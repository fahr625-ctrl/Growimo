// ── F5 Kanal-Aktionspläne: Asset-Extraktion ──────────────────────────────────
// Pulls the CONCRETE values (title, keywords, CTA, hook, alt text, tags, …) out
// of a generated asset so the deterministic step templates in rules.ts can
// reference real content instead of generic advice. Metadata is preferred,
// body sections are the fallback — both are produced by the same generation,
// so the values stay consistent. Pure functions, never throw.
import type { ContentType } from '~/ai/types';
import { blockByHeading, extractBlocks } from '~/ai/scoring/sections';

export interface ActionPlanAsset {
  channel: ContentType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/** Everything the step templates may interpolate. */
export interface ExtractedAsset {
  /** Title to publish (channel-appropriate, already cleaned of quotes). */
  title: string;
  /** Keywords as an array (focusKeywords / tags / LSI per channel). */
  keywords: string[];
  /** First up-to-3 keywords — used for board/tag selections. */
  firstKeywords: string[];
  /** Call-to-action sentence, when the asset contains one. */
  cta: string | null;
  /** Opening hook / first sentence of the intro or short description. */
  hook: string | null;
  altText: string | null;
  hashtags: string[];
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  slug: string | null;
  h1: string | null;
  category: string | null;
  style: string | null;
  primaryColor: string | null;
  shortDesc: string | null;
  /** Raw focus keyword (SEO) without surrounding quotes. */
  focusKeyword: string | null;
}

const QUOTE_RE = /^[\s"„“»«''"]+|[\s"„“»«''"]+$/g;

function clean(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(QUOTE_RE, '').trim();
}

function metaStr(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function metaList(meta: Record<string, unknown> | undefined, key: string): string[] {
  const v = meta?.[key];
  if (Array.isArray(v)) {
    return v.map((x) => clean(String(x))).filter(Boolean);
  }
  if (typeof v === 'string' && v.trim()) {
    return splitList(v);
  }
  return [];
}

function splitList(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[,;\n]/)
    .map((x) => clean(x))
    .filter((x) => x.length > 0 && x !== '(LSI)');
}

/** First block whose heading contains any of the given keywords. */
function bodySection(body: string, headings: string[]): string | null {
  const blocks = extractBlocks(body);
  const block = blockByHeading(blocks, headings);
  return block?.content?.trim() ?? null;
}

/** First sentence of a longer text (used for hooks). */
function firstSentence(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^[^.!?]+[.!?]?/);
  const sentence = m?.[0]?.trim() ?? t;
  return sentence.length > 160 ? sentence.slice(0, 157).trimEnd() + '…' : sentence;
}

function base(
  title: string,
  _body: string,
  _metadata: Record<string, unknown> | undefined,
): ExtractedAsset {
  return {
    title: clean(title),
    keywords: [],
    firstKeywords: [],
    cta: null,
    hook: null,
    altText: null,
    hashtags: [],
    tags: [],
    metaTitle: null,
    metaDescription: null,
    slug: null,
    h1: null,
    category: null,
    style: null,
    primaryColor: null,
    shortDesc: null,
    focusKeyword: null,
  };
}

export function extractPinterest(a: ActionPlanAsset): ExtractedAsset {
  const e = base(a.title, a.body, a.metadata);
  e.title = clean(a.title) || 'deinen Pin-Titel';
  e.keywords = metaList(a.metadata, 'keywords');
  if (e.keywords.length === 0) e.keywords = splitList(bodySection(a.body, ['Fokus-Keywords']));
  e.firstKeywords = e.keywords.slice(0, 3);
  e.cta = clean(metaStr(a.metadata, 'cta') ?? bodySection(a.body, ['Call to Action', 'CTA'])) || null;
  e.altText = metaStr(a.metadata, 'altText') ?? bodySection(a.body, ['Alt-Text']);
  e.hashtags = metaList(a.metadata, 'hashtags');
  if (e.hashtags.length === 0) e.hashtags = splitList(bodySection(a.body, ['Hashtags']));
  e.category = metaStr(a.metadata, 'category') ?? bodySection(a.body, ['Pin-Kategorie', 'Kategorie']);
  e.hook = e.title;
  return e;
}

export function extractEtsy(a: ActionPlanAsset): ExtractedAsset {
  const e = base(a.title, a.body, a.metadata);
  e.title = clean(a.title) || 'deinen Listing-Titel';
  e.keywords = metaList(a.metadata, 'focusKeywords');
  if (e.keywords.length === 0) e.keywords = metaList(a.metadata, 'tags');
  if (e.keywords.length === 0) e.keywords = splitList(bodySection(a.body, ['Fokus-Keywords']));
  e.firstKeywords = e.keywords.slice(0, 3);
  e.tags = metaList(a.metadata, 'tags');
  if (e.tags.length === 0) e.tags = splitList(bodySection(a.body, ['Etsy-Tags', 'Tags']));
  e.shortDesc = bodySection(a.body, ['Kurzbeschreibung']);
  e.hook = firstSentence(e.shortDesc) ?? e.title;
  e.category = metaStr(a.metadata, 'category') ?? bodySection(a.body, ['Kategorie']);
  e.style = metaStr(a.metadata, 'style') ?? bodySection(a.body, ['Stil']);
  e.primaryColor = metaStr(a.metadata, 'primaryColor') ?? bodySection(a.body, ['Primärfarbe']);
  e.altText = bodySection(a.body, ['Alt-Text']);
  return e;
}

export function extractSeo(a: ActionPlanAsset): ExtractedAsset {
  const e = base(a.title, a.body, a.metadata);
  e.focusKeyword = clean(metaStr(a.metadata, 'focusKeyword') ?? bodySection(a.body, ['Fokus-Keyword']));
  e.h1 = bodySection(a.body, ['SEO-Titel', 'H1']);
  e.metaTitle = metaStr(a.metadata, 'metaTitle') ?? bodySection(a.body, ['Meta-Titel']);
  e.metaDescription =
    metaStr(a.metadata, 'metaDescription') ?? bodySection(a.body, ['Meta-Beschreibung']);
  e.slug = metaStr(a.metadata, 'slug') ?? bodySection(a.body, ['URL-Slug']);
  const lsi = metaList(a.metadata, 'lsiKeywords').filter((k) => k !== '(LSI)');
  const lsiBody = splitList(bodySection(a.body, ['Keywords', 'LSI'])).filter((k) => k !== '(LSI)');
  e.keywords = [e.focusKeyword, ...lsi, ...lsiBody].filter(Boolean).filter((k, i, arr) => arr.indexOf(k) === i);
  if (e.keywords.length === 0) e.keywords = [e.focusKeyword ?? 'dein Fokus-Keyword'].filter(Boolean);
  e.firstKeywords = e.keywords.slice(0, 3);
  e.title = e.h1 || e.metaTitle || clean(a.title) || 'deinen Blogartikel';
  e.cta = bodySection(a.body, ['Call-to-Action', 'CTA']);
  e.hook = firstSentence(bodySection(a.body, ['Einleitung', 'Hook']));
  e.altText = metaStr(a.metadata, 'altText');
  return e;
}

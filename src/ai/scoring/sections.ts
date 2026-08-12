// ── Body section extraction for the F1 scoring rules ─────────────────────────
// Generated AI output follows a predictable structure ("1. Heading\ncontent",
// "### Heading\ncontent", or platform labels like "📸 Instagram:"). These
// helpers turn a raw body into addressable sections so rule checks can measure
// specific parts (title section, description, tags, CTA, …) deterministically.

export interface SectionBlock {
  heading: string;
  content: string;
}

const NUMBERED_HEADING_RE = /^\s*(\d{1,2})\s*[.)]\s+(.+?)\s*$/;
const HASH_HEADING_RE = /^\s*#{1,4}\s+(.+?)\s*$/;

/**
 * True when a raw body line is a section heading (same rules as extractBlocks:
 * numbered "1. …", markdown "### …", or platform label lines). Returns the
 * parsed heading text or null. Exported so the F2.1 splice uses EXACTLY the
 * same block boundaries as the F1 scoring rules.
 */
export function isSectionHeading(line: string): string | null {
  const trimmed = line.trim();
  const mN = trimmed.match(NUMBERED_HEADING_RE);
  if (mN && trimmed.length < 90) return trimmed; // keep the number prefix
  const mH = trimmed.match(HASH_HEADING_RE);
  if (mH && trimmed.length < 90) return mH[1].trim();
  // Platform label lines: "📸 Instagram:", "Version 1 – Instagram", "Instagram (…):"
  if (
    trimmed.length < 60 &&
    (/^(📸|💬|🎬|💡|✨|📋|🎯)\s*/.test(trimmed) ||
      /^Version\s*\d+\s*[–—-]/.test(trimmed) ||
      /^[A-ZÄÖÜ][A-Za-zÄÖÜäöü0-9 &()/]+:$/.test(trimmed))
  ) {
    return trimmed.replace(/[:\s]+$/, '');
  }
  return null;
}

/**
 * Split a body into blocks. Handles:
 *  - "1. Heading" / "1) Heading" numbered sections
 *  - "### Heading" markdown sections
 *  - Label lines such as "📸 Instagram:" or "Version 1 – Instagram"
 * Returns blocks with their content (content runs until the next heading).
 */
export function extractBlocks(body: string): SectionBlock[] {
  const lines = body.split('\n');
  const blocks: SectionBlock[] = [];
  let current: SectionBlock | null = null;

  for (const line of lines) {
    const heading = isSectionHeading(line);
    if (heading && !line.trim().endsWith('.') && line.trim().length > 1) {
      if (current) blocks.push(current);
      current = { heading, content: '' };
    } else if (current) {
      current.content += current.content ? '\n' + line : line;
    }
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({ heading: b.heading, content: b.content.trim() }));
}

/** Find the first block whose heading contains any of the given keywords. */
export function blockByHeading(
  blocks: SectionBlock[],
  keywords: string[],
): SectionBlock | null {
  return (
    blocks.find((b) => keywords.some((k) => b.heading.toLowerCase().includes(k.toLowerCase()))) ??
    null
  );
}

/** Find the block with the given section number (based on "N." prefixes). */
export function blockByNumber(
  blocks: SectionBlock[],
  number: number,
): SectionBlock | null {
  const re = new RegExp(`^\\s*${number}\\s*[.)]`);
  for (const b of blocks) {
    // Re-derive numbering from the raw heading when available
    const m = b.heading.match(/^\s*(\d{1,2})\s*[.)]\s+(.+)$/);
    if (m && Number(m[1]) === number) return b;
  }
  void re;
  return null;
}

/** All blocks that begin with "N." — mapped by their number. */
export function numberedBlocks(blocks: SectionBlock[]): Map<number, SectionBlock> {
  const map = new Map<number, SectionBlock>();
  for (const b of blocks) {
    const m = b.heading.match(/^\s*(\d{1,2})\s*[.)]\s+(.+)$/);
    if (m) map.set(Number(m[1]), b);
  }
  return map;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function charCount(text: string): number {
  return text.length;
}

/** Count lines matching a regex (used for headings, FAQ questions, bullets…). */
export function countLines(text: string, re: RegExp): number {
  return text.split('\n').filter((l) => re.test(l)).length;
}

// ── F2.1 deterministic section splice ─────────────────────────────────────────

export interface SectionSplice {
  /** The body with only the target section replaced (identical otherwise). */
  body: string;
  /** true when the heading was found and the content replaced. */
  found: boolean;
  /** The exact content that was replaced (trimmed), for before/after display. */
  oldContent: string;
}

/**
 * Replace the content of the FIRST section whose heading contains any of the
 * given keywords. Everything outside the target section stays byte-identical —
 * this is the hard guarantee behind F2.1 ("only the affected area changes").
 *
 * Handles both layout forms produced by the generators:
 *  - block form: "3. Vollständige Etsy-Beschreibung" on its own line, content
 *    on the following lines until the next heading (or end of body)
 *  - inline form: "SEO Pin-Titel: aktueller Wert" on the same line as the
 *    heading (only the text after the colon is replaced)
 */
export function replaceSectionContent(
  body: string,
  headingKeywords: string[],
  newContent: string,
): SectionSplice {
  const lines = body.split('\n');
  const trimmed = (newContent ?? '').trim();
  if (!trimmed) return { body, found: false, oldContent: '' };

  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = isSectionHeading(lines[i]);
    if (h && headingKeywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return { body, found: false, oldContent: '' };

  // Inline form: the heading line also carries the value after a colon.
  const inline = lines[headingIdx].match(/^(\s*(?:\d{1,2}\s*[.)]\s*)?[^:：]{0,80}[:：]\s*)(.+)$/);
  if (inline && inline[2].trim().length > 0) {
    const next = lines.slice(headingIdx + 1);
    return {
      found: true,
      oldContent: inline[2].trim(),
      body: [...lines.slice(0, headingIdx), inline[1] + trimmed, ...next].join('\n'),
    };
  }

  // Block form: heading on its own line, content until the next heading.
  // Replace ONLY the non-blank content lines — blank lines around the content
  // are preserved so the overall layout stays byte-identical outside the
  // target section (the hard F2.1 guarantee).
  let nextIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (isSectionHeading(lines[i])) {
      nextIdx = i;
      break;
    }
  }
  let firstContentIdx = -1;
  let lastContentIdx = -1;
  for (let i = headingIdx + 1; i < nextIdx; i++) {
    if (lines[i].trim().length > 0) {
      if (firstContentIdx === -1) firstContentIdx = i;
      lastContentIdx = i;
    }
  }
  if (firstContentIdx === -1) {
    // Empty section — nothing to replace (caller should treat as not found).
    return { body, found: false, oldContent: '' };
  }
  const oldContent = lines.slice(firstContentIdx, lastContentIdx + 1).join('\n').trim();
  const replacement = trimmed.split('\n');
  const newLines = [
    ...lines.slice(0, firstContentIdx),
    ...replacement,
    ...lines.slice(lastContentIdx + 1),
  ];
  return { found: true, oldContent, body: newLines.join('\n') };
}

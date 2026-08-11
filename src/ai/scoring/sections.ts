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

  const isHeading = (line: string): string | null => {
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
  };

  for (const line of lines) {
    const heading = isHeading(line);
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

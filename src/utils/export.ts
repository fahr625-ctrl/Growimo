import type { Project, StoredContent } from '~/store/projects';
import { getContentTypeConfig } from '~/ai/content-types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatChannelSection(content: StoredContent, asMarkdown: boolean): string {
  const config = getContentTypeConfig(content.contentType);
  const icon = config?.icon ?? '📄';
  const label = config?.label ?? content.contentType;

  if (asMarkdown) {
    return [
      `## ${icon} ${label}`,
      '',
      `**${content.title}**`,
      '',
      content.body,
      '',
    ].join('\n');
  }

  return [
    `${icon} ${label}`,
    content.title,
    '-'.repeat(40),
    content.body,
    '',
  ].join('\n');
}

// ── Dateiname + Dokument-Bauer (rein, ohne DOM → testbar) ─────────────────────

/**
 * Dateiname nach dem Muster `growimo-<projekt>-<typ>.<ext>` (FIX-BLOCK 2).
 * Beide Teile werden ASCII-sicher slugifiziert (deutsche Umlaute → ae/oe/ue,
 * ß → ss, sonstige Akzente entfernt).
 */
export function exportFileName(projectTitle: string, part: string, ext: 'md' | 'txt' = 'md'): string {
  const slug = (value: string) =>
    value
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae')
      .replace(/Ö/g, 'Oe')
      .replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'export';
  return `growimo-${slug(projectTitle)}-${slug(part)}.${ext}`;
}

/** Baut das Markdown-Dokument (ohne Download) — Grundlage von exportMarkdown. */
export function buildMarkdownExport(project: Project, contents: StoredContent[], locale: 'de' | 'en' = 'de'): string {
  const configs = contents.map((c) => getContentTypeConfig(c.contentType));
  const channelList = configs.map((c) => `${c?.icon ?? '📄'} ${c?.label ?? ''}`).join(' · ');
  const created = project.createdAt.toLocaleDateString(locale === 'en' ? 'en-US' : 'de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const header = [
    `# ${project.title}`,
    '',
    `> ${project.productIdea}`,
    '',
    `**${locale === 'en' ? 'Created' : 'Erstellt'}:** ${created}`,
    '',
    `**${locale === 'en' ? 'Channels' : 'Kanäle'}:** ${channelList}`,
    '',
    '---',
    '',
  ].join('\n');

  return header + contents.map((c) => formatChannelSection(c, true)).join('\n---\n\n');
}

/** Baut das Klartext-Dokument (ohne Download) — Grundlage von exportText. */
export function buildTextExport(project: Project, contents: StoredContent[], locale: 'de' | 'en' = 'de'): string {
  const configs = contents.map((c) => getContentTypeConfig(c.contentType));
  const channelList = configs.map((c) => `${c?.icon ?? '📄'} ${c?.label ?? ''}`).join(' · ');
  const created = project.createdAt.toLocaleDateString(locale === 'en' ? 'en-US' : 'de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const header = [
    project.title.toUpperCase(),
    '='.repeat(60),
    '',
    project.productIdea,
    '',
    `${locale === 'en' ? 'Created' : 'Erstellt'}: ${created}`,
    `${locale === 'en' ? 'Channels' : 'Kanäle'}: ${channelList}`,
    '',
    '='.repeat(60),
    '',
  ].join('\n');

  return header + contents.map((c) => formatChannelSection(c, false)).join('');
}

// ── Markdown Export ────────────────────────────────────────────────────────────

export function exportMarkdown(project: Project, contents: StoredContent[], opts?: { filename?: string; locale?: 'de' | 'en' }) {
  const filename =
    opts?.filename ?? `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${project.id}.md`;
  downloadFile(filename, buildMarkdownExport(project, contents, opts?.locale ?? 'de'), 'text/markdown;charset=utf-8');
}

// ── Text Export ────────────────────────────────────────────────────────────────

export function exportText(project: Project, contents: StoredContent[], opts?: { filename?: string; locale?: 'de' | 'en' }) {
  const filename =
    opts?.filename ?? `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${project.id}.txt`;
  downloadFile(filename, buildTextExport(project, contents, opts?.locale ?? 'de'), 'text/plain;charset=utf-8');
}

// ── Copy All Formatted ─────────────────────────────────────────────────────────

export async function copyAllFormatted(project: Project, contents: StoredContent[]): Promise<boolean> {
  const sections = contents.map((c) => formatChannelSection(c, false));
  const header = [
    `${project.title}`,
    '='.repeat(40),
    '',
    project.productIdea,
    '',
  ].join('\n');

  const full = header + sections.join('\n');
  try {
    await navigator.clipboard.writeText(full);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = full;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  }
}

// ── Coming soon placeholders ───────────────────────────────────────────────────

export function exportPdfPlaceholder() {
  alert('PDF-Export — In Kürze verfügbar\n\nWir arbeiten an einem serverseitigen PDF-Export, der dein Projekt als professionelles PDF-Dokument ausgibt. Bald verfügbar!');
}

export function exportWordPlaceholder() {
  alert('Word-Export — In Kürze verfügbar\n\nWir arbeiten an einem serverseitigen Word-Export, der dein Projekt als .docx-Dokument ausgibt. Bald verfügbar!');
}

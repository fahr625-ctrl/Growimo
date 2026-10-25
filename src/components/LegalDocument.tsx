import type { ReactNode } from 'react';
import type { LegalSection } from '~/lib/legal-docs';

/**
 * Renderer für die langen Rechtstexte (AGB, Widerrufsbelehrung).
 *
 * Die Inhalte kommen strukturiert aus `src/lib/legal-docs.ts` (maschinell aus
 * den Freigabe-Dokumenten übernommen). Hier wird nur dargestellt — es gibt
 * KEINE zweite Textkopie im Code.
 */

const EMAIL = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;
const EMAIL_SPLIT = /([\w.+-]+@[\w-]+\.[\w.-]+)/g;

/** E-Mail-Adressen im Vertragstext als mailto-Link (sonst reiner Text). */
function linkify(text: string): ReactNode {
  const parts = text.split(EMAIL_SPLIT);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    EMAIL.test(part) ? (
      <a key={i} href={`mailto:${part}`} className="text-blue-600 hover:underline">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function LegalDocument({ sections }: { sections: LegalSection[] }) {
  return (
    <div data-testid="legal-document">
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900">{section.title}</h2>
          {section.blocks.map((block, index) => {
            if (block.kind === 'list') {
              return (
                <ul
                  key={index}
                  className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-gray-600"
                >
                  {block.items.map((item, i) => (
                    <li key={i}>{linkify(item)}</li>
                  ))}
                </ul>
              );
            }
            if (block.kind === 'table') {
              return (
                <div key={index} className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        {block.head.map((cell, i) => (
                          <th key={i} className="py-2 pr-4 font-semibold text-gray-900">
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, r) => (
                        <tr key={r} className="border-b border-gray-100 align-top">
                          {row.map((cell, c) => (
                            <td key={c} className="py-2 pr-4 text-gray-600">
                              {linkify(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            if (block.kind === 'blank') {
              // Ausfülllinie des Muster-Widerrufsformulars
              return (
                <div
                  key={index}
                  className="mt-4 h-5 border-b border-gray-300"
                  aria-hidden="true"
                />
              );
            }
            return (
              <p key={index} className="mt-3 text-sm leading-relaxed text-gray-600">
                {linkify(block.text)}
              </p>
            );
          })}
        </section>
      ))}
    </div>
  );
}

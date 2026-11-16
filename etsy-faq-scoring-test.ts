// ─────────────────────────────────────────────────────────────────────────────
// Owner-Entscheidung 2026-11-15 — ETSY-BEWERTUNG OHNE FAQ-PFLICHT
// Zwei Prüffälle, kein KI-Aufruf (OPENAI_API_KEY wird im Skript entfernt ⇒ das
// LLM-Urteil fällt aus und es bleibt der deterministische Regel-Score; keine
// Kosten, kein Netzwerk).
//
// Usage (aus der Repo-Wurzel):
//   bun etsy-faq-scoring-test.ts
//
// Prüffall 1 — Nutzer nennt KEINE Lieferumfang-Angaben, Listing OHNE FAQ:
//   Erwartet: FAQ-Prüfung gilt als bestanden („keine FAQ — freiwillig, kein
//   Abzug"), der Score ist so hoch wie mit vollständiger FAQ (kein Abzug), und
//   KEIN Hinweis nennt Lieferung, Rückgabe, Lieferumfang, Dateiformate, Größe,
//   Download oder Drucker.
//
// Prüffall 2 — Nutzer nennt Formate („PDF und JPG, 3 Dateien"), FAQ ist dünn:
//   Erwartet: der Hinweis nennt GENAU diese Angaben (PDF, JPG) und nichts
//   darüber hinaus — kein PNG/SVG, keine Rückgabe, kein Download, kein Drucker.
// ─────────────────────────────────────────────────────────────────────────────
delete process.env.OPENAI_API_KEY; // LLM-Urteil aus ⇒ nur Regeln, keine Kosten

import { scoreContent, SCORE_TARGET } from './src/ai/scoring';
import { runRules } from './src/ai/scoring/rules';
import type { ContentResult } from './src/ai/types';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const TAGS = [
  'gäste wc poster', 'wc spruch', 'schwarzweiß deko', 'badezimmer bild',
  'klopapier spruch', 'toilette poster', 'digitaler druck', 'wandbild wc',
  'humor poster', 'gästetoilette', 'typografie poster', 'minimal deko',
  'einweihungsgeschenk',
];

const DESCRIPTION = [
  'Dieses Poster bringt trockenen Humor an genau die Stelle, an der er wirkt: ',
  'ein schlichtes Schwarz-Weiß-Design mit dem Spruch „Hier sitzt du richtig". ',
  'Die klare Typografie fügt sich in ein modernes Gäste-WC ebenso ein wie in ein ',
  'klassisch eingerichtetes Badezimmer. Weil das Motiv zurückhaltend bleibt, ',
  'wirkt der Spruch als kleine Pointe im Vorbeigehen und drängt sich nicht auf. ',
  'Das Poster passt zu allen, die ihr Zuhause mit einem Augenzwinkern einrichten ',
  'und Gästen beim ersten Besuch ein Lächeln entlocken möchten. Auch als ',
  'Einweihungsgeschenk für die erste eigene Wohnung macht es eine gute Figur: ',
  'persönlich, ohne kitschig zu sein. Das Motiv ist auf eine ruhige, gut lesbare ',
  'Schrift reduziert und bleibt damit über Jahre zeitlos. Kombiniert mit einem ',
  'schmalen Rahmen wirkt es wie ein bewusst gesetzter Akzent an der Wand. ',
  'Wenn du magst, hängst du es zusammen mit einem zweiten Spruch auf und bildest ',
  'eine kleine Reihe — das wirkt besonders in schmalen Räumen ruhig und geordnet.',
].join('');

const CTA =
  'Jetzt gehört es dir: Hol dir den Spruch an deine Wand und freu dich auf den ersten Gast, der schmunzelt.';

/** Vollständige FAQ (3 Fragen) — für den Vergleich „mit FAQ". */
const FAQ_FULL = [
  '**Kann ich das Poster selbst aufhängen?**',
  'Ja, mit einem Rahmen oder einer Klemmschiene befestigst du es in wenigen Minuten.',
  '**Passt das Motiv zu einem hellen Bad?**',
  'Ja, das Schwarz-Weiß-Design wirkt auf hellen Wänden ruhig und gut lesbar.',
  '**Eignet es sich als Geschenk?**',
  'Ja, zur Einweihung oder als Mitbringsel passt der Spruch zu vielen Anlässen.',
].join('\n');

/** Dünne FAQ (1 Frage) — löst den Verbesserungshinweis aus. */
const FAQ_THIN = [
  '**Passt das Motiv zu einem hellen Bad?**',
  'Ja, das Schwarz-Weiß-Design wirkt auf hellen Wänden ruhig und gut lesbar.',
].join('\n');

function etsyBody(faq: string | null): string {
  const fields: string[] = [
    '1. SEO-Titel',
    'Gäste-WC-Poster Digital | Spruch „Hier sitzt du richtig" | Schwarz-Weiß Dekor | Klare Typografie',
    '2. 13 Etsy-Tags',
    TAGS.join(', '),
    '3. Vollständige Etsy-Beschreibung',
    DESCRIPTION,
    '4. Das Besondere',
    'Reduzierte Typografie, die den Spruch wirken lässt, statt ihn zu überdecken.',
    '5. Auf einen Blick',
    'Schwarz-Weiß-Motiv mit Spruch, ruhige Schrift, für das Gäste-WC gedacht.',
    '6. Longtail-Keywords',
    'gäste wc poster spruch, wc bild mit spruch, toilette deko schwarzweiß',
    '7. Kategorie',
    'Kunst & Sammlerstücke > Drucke > Digitale Drucke',
    '8. Primärfarbe',
    'Kreideweiß',
    '9. Sekundärfarbe',
    'Tiefschwarz',
    '10. Stil',
    'Minimalistisch',
    '11. Anlass',
    'Einweihungsgeschenk, Geschenk für Humorliebhaber',
    '12. Zielgruppe',
    'Du bist jemand, der kleine, feine Details schätzt.',
    '13. Materialien',
    'Digitaler Druck',
    '14. Bild-Dateiname',
    'gaeste-wc-poster-spruch-hier-sitzt-du-richtig.jpg',
    '15. SEO-Alt-Text',
    'Schwarz-weißes Gäste-WC-Poster mit dem Spruch Hier sitzt du richtig in klarer Typografie',
  ];
  if (faq !== null) fields.push('16. FAQ', faq);
  fields.push(
    '17. Jetzt gehört es dir',
    CTA,
    '18. Preisstrategie',
    'Als Digitalprodukt ohne Versandkosten kalkuliert.',
    '19. Versand',
    'Keine Angabe vom Nutzer — kein Versandtext.',
    '20. Personalisierung',
    'Nicht vorgesehen.',
    '21. Rückgabe',
    'Keine Angabe vom Nutzer — kein Rückgabetext.',
    '22. Ziel-Keywords',
    'wc poster, spruch poster, badezimmer deko',
  );
  return fields.join('\n');
}

function etsyResult(faq: string | null): ContentResult {
  return {
    contentType: 'etsy_listing',
    title: 'Gäste-WC-Poster Digital | Spruch „Hier sitzt du richtig" | Schwarz-Weiß Dekor | Klare Typografie',
    body: etsyBody(faq),
    metadata: {
      focusKeywords: [
        'gäste-wc-poster',
        'wc spruch',
        'toilette poster',
        'badezimmer bild schwarzweiß',
        'humor poster',
        'einweihungsgeschenk poster',
      ],
      tags: TAGS,
      longtailKeywords: [
        'gäste wc poster spruch',
        'wc bild mit spruch',
        'toilette deko schwarzweiß',
        'poster für gästetoilette',
        'humorvolles badezimmer bild',
        'schwarzweiß poster typografie',
        'spruch poster als geschenk',
        'einweihungsgeschenk wandbild',
        'minimalistisches wc dekor',
        'poster spruch klare schrift',
      ],
      altText: 'Schwarz-weißes Gäste-WC-Poster mit dem Spruch Hier sitzt du richtig in klarer Typografie',
    },
  };
}

/** Wörter, die ohne Nutzerangabe in keinem Hinweis stehen dürfen. */
const FORBIDDEN_WORDS = [
  'liefer', 'versand', 'rückgabe', 'rueckgabe', 'retoure', 'umtausch', 'lieferumfang',
  'dateiformat', 'format', 'pdf', 'png', 'jpg', 'jpeg', 'svg', 'dxf', 'eps', 'psd',
  'download', 'herunterlad', 'drucker', 'druckfertig', 'größe', 'groesse', 'auflösung', 'dpi',
];

function hintTexts(issues: Array<{ message: string; fix: { suggestion: string } }>): string[] {
  return issues.flatMap((i) => [i.message, i.fix.suggestion]);
}

function forbiddenHits(texts: string[], extraForbidden: string[] = []): string[] {
  const hits: string[] = [];
  for (const text of texts) {
    const l = text.toLowerCase();
    for (const w of [...FORBIDDEN_WORDS, ...extraForbidden]) {
      if (l.includes(w)) hits.push(`${w} in „${text}"`);
    }
  }
  return [...new Set(hits)];
}

const NO_DETAILS =
  'Ein Gäste-WC-Poster mit dem Spruch „Hier sitzt du richtig", schwarz-weiß, klare Typografie, für Menschen mit Humor.';
const WITH_FORMATS =
  'Ein Gäste-WC-Poster mit dem Spruch „Hier sitzt du richtig", schwarz-weiß, klare Typografie. Das Poster kommt als PDF und JPG, insgesamt 3 Dateien.';

async function main(): Promise<void> {
  console.log('── Prüffall 1: keine Nutzerangaben, Listing OHNE FAQ ──────────────────');
  const noFaq = etsyResult(null);
  const withFaq = etsyResult(FAQ_FULL);
  const scoreNoFaq = await scoreContent({ contentType: 'etsy_listing', productIdea: NO_DETAILS }, noFaq);
  const scoreWithFaq = await scoreContent({ contentType: 'etsy_listing', productIdea: NO_DETAILS }, withFaq);
  const rulesNoFaq = runRules(noFaq, NO_DETAILS);
  const faqOutcome = rulesNoFaq.outcomes[7]; // 8. Prüfung der Etsy-Regeln = FAQ

  console.log(`  Score ohne FAQ: ${scoreNoFaq.total}/100 · Score mit FAQ: ${scoreWithFaq.total}/100`);
  console.log(`  FAQ-Prüfung: pass=${faqOutcome?.pass} · "${faqOutcome?.message}"`);
  check('fehlende FAQ ist kein Mangel (Prüfung bestanden)', faqOutcome?.pass === true, faqOutcome?.message);
  check(
    'fehlende FAQ senkt den Score nicht (gleich hoch wie mit FAQ)',
    scoreNoFaq.total === scoreWithFaq.total,
    `ohne=${scoreNoFaq.total} mit=${scoreWithFaq.total}`,
  );
  check(`Score bleibt gut (≥ ${SCORE_TARGET})`, scoreNoFaq.total >= SCORE_TARGET, `${scoreNoFaq.total}`);
  const structure = scoreNoFaq.subScores?.find((s) => s.key === 'structure');
  if (process.env.DEBUG_FAQ) {
    for (const o of rulesNoFaq.outcomes) console.log(`    [${o.dimension}] pass=${o.pass} ${o.message}`);
    for (const s of scoreNoFaq.subScores ?? []) console.log(`    dim ${s.key}=${s.score}`);
  }
  check('Struktur-Teilwert voll (FAQ-Abzug weg)', structure?.score === 100, JSON.stringify(structure));
  check(
    'kein Hinweis nennt Lieferung/Rückgabe/Formate/Größe/Download/Drucker',
    forbiddenHits(hintTexts(scoreNoFaq.issues)).length === 0,
    forbiddenHits(hintTexts(scoreNoFaq.issues)).join(' | '),
  );

  console.log('');
  console.log('── Prüffall 2: Nutzer nennt PDF + JPG, FAQ ist dünn ───────────────────');
  const thin = etsyResult(FAQ_THIN);
  const scoreThin = await scoreContent({ contentType: 'etsy_listing', productIdea: WITH_FORMATS }, thin);
  const faqHint = scoreThin.issues.find((i) => i.fix.field === 'faq');
  console.log(`  Hinweis: "${faqHint?.fix.suggestion ?? '(keiner)'}"`);
  check('Hinweis zur FAQ entsteht', !!faqHint);
  check(
    'Hinweis nennt die genannten Formate (PDF, JPG)',
    !!faqHint && /\bPDF\b/.test(faqHint.fix.suggestion) && /\bJPG\b/.test(faqHint.fix.suggestion),
    faqHint?.fix.suggestion,
  );
  const ungrounded = hintTexts([faqHint].filter(Boolean) as Array<{ message: string; fix: { suggestion: string } }>);
  const invented = forbiddenHits(ungrounded, ['png', 'svg', 'eps', 'psd', 'tiff', 'dxf']);
  const onlyNamed = invented.filter((h) => !/pdf|jpg/.test(h));
  check(
    'Hinweis nennt nichts außer den genannten Fakten',
    onlyNamed.length === 0,
    onlyNamed.join(' | '),
  );
  check(
    'ohne Rückgabe-/Lieferangabe auch kein Rückgabe-/Lieferhinweis',
    !/rückgabe|retoure|umtausch|lieferzeit|versand|lieferumfang|download|drucker/i.test(
      `${faqHint?.message ?? ''} ${faqHint?.fix.suggestion ?? ''}`,
    ),
    `${faqHint?.message} ${faqHint?.fix.suggestion}`,
  );

  console.log('');
  if (failures === 0) {
    console.log('ERGEBNIS: alle Prüfungen bestanden.');
  } else {
    console.log(`ERGEBNIS: ${failures} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
}

void main();

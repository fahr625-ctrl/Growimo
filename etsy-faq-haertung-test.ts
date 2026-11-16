// ─────────────────────────────────────────────────────────────────────────────
// Owner-Auftrag 2026-11-15 — ETSY-PROMPT-HÄRTUNG (LIEFERUMFANG IN DER FAQ)
// Zwei Prüffälle, kein echter KI-Aufruf (fetch-Stub, keine Kosten).
//
// Usage (aus der Repo-Wurzel):
//   bun etsy-faq-haertung-test.ts
//
// Beleg-Grundlage: echter Live-Lauf 2026-11-15
// (/home/team/shared/etsy-echtlauf-2026-11-15/result-card-raw.txt, Feld 16 FAQ).
//
// Prüffall 1 — Nutzer nennt KEINE Lieferumfang-Angaben:
//   Das Modell erfindet „Der Download-Link enthält verschiedene gängige Formate",
//   „Drucke es in deiner Lieblingsgröße", „… mit den meisten Standarddruckern".
//   Erwartet: Sektion 16 FAQ fällt GANZ weg (keine Überschrift, keine Frage).
//
// Prüffall 2 — Nutzer nennt Formate und Größen („PDF", „30x40 cm", „50x70 cm"):
//   Erwartet: die belegten Fakten bleiben stehen, erfundene Zusätze (PNG/SVG,
//   Download-Link, Standarddrucker) fliegen raus.
//
// Zusätzlich: die Prompt-Regel geht wirklich raus (System-Prompt am Stub
// abgegriffen) und belegte Aussagen werden NICHT geflaggt (keine Fehlalarme).
// Keine DB-, keine Netzwerk-, keine LLM-Aufrufe.
// ─────────────────────────────────────────────────────────────────────────────
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}
(globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();

import { factViolations, stripUngroundedEtsyFaq } from './src/ai/fact-guard';
import { buildSystemPrompt } from './src/ai/providers/openai';
import { runWithContextLoyalty } from './src/ai/generate';
import type { ContentRequest } from './src/ai/types';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── fetch-Stub: fängt den OpenAI-Call ab, liefert festen Text, merkt sich den
//    System-Prompt, den der Provider WIRKLICH sendet. ─────────────────────────
const realFetch = globalThis.fetch;
let stubText = '';
let stubCalls = 0;
let seenSystemPrompt = '';
let seenUserPrompt = '';
(globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: { body?: string }) => {
  const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? '');
  if (!url.includes('api.openai.com')) {
    throw new Error(`Unerwarteter Netzwerk-Aufruf im Test: ${url}`);
  }
  stubCalls++;
  try {
    const body = JSON.parse(init?.body ?? '{}') as { messages?: { role: string; content: string }[] };
    seenSystemPrompt = body.messages?.find((m) => m.role === 'system')?.content ?? '';
    seenUserPrompt = body.messages?.find((m) => m.role === 'user')?.content ?? '';
  } catch {
    /* Stub-Body nicht lesbar — kein Testabbruch */
  }
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: stubText, refusal: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
process.env.OPENAI_API_KEY = 'stub-key-nur-fuer-den-test';

// ── Listing-Vorlage (22 Felder, wie im echten Lauf) ─────────────────────────
function listing(faq: string): string {
  return `1. SEO-Titel
Gäste-WC-Poster Digital | Spruch „Hier sitzt du richtig" | Schwarz-Weiß Dekor | Klare Typografie

2. Kurzbeschreibung
Mach dein Gäste-WC zur charmanten Oase! Mit dem digitalen Poster „Hier sitzt du richtig" in schwarz-weiß und klarer Typografie.

3. Vollständige Etsy-Beschreibung
a) ✨ Das Besondere daran
Ein kleines Detail, das sofort ein Lächeln ins Gesicht zaubert.

b) 📋 Auf einen Blick
Dieses digitale Poster ist bereit, dein Gäste-WC aufzupeppen.

c) 🎯 Perfekt für dich, wenn…
Du liebst es, wenn dein Zuhause Persönlichkeit hat.

d) 🎁 Die besondere Geschenkidee
Ein Geschenk, das in Erinnerung bleibt.

e) 💛 Jetzt gehört es dir
Klicke jetzt auf „In den Warenkorb" und bringe ein Lächeln in dein Gäste-WC.

4. 13 Etsy-Tags
Gäste-WC Deko, Poster digital, Schwarz-Weiß Print, Humorvolle Sprüche, Badezimmer Kunst, Typografie Poster, Wandkunst modern, Einweihungsgeschenk, Minimalistisches, Lustige Wandkunst, Home Decor, WC Humor, Bad Deko

5. Fokus-Keywords
Gäste-WC-Poster, Digitales Poster, Schwarz-Weiß Poster, Typografie Kunst, Lustige Sprüche

6. Longtail-Keywords
Digitales Gäste-WC-Poster, Spruch Poster Badezimmer, Schwarz-Weiß Typografie Poster

7. Kategorie
Kunst & Sammlerstücke > Drucke > Digitale Drucke

8. Primärfarbe
Kreideweiß

9. Sekundärfarbe
Tiefschwarz

10. Stil
Minimalistisch

11. Anlass
Einweihungsgeschenk, Geschenk für Humorliebhaber

12. Zielgruppe
Du bist jemand, der kleine, feine Details schätzt.

13. Materialien
Nicht zutreffend

14. Dateiname Produktbild
gaeste-wc-poster-digital-schwarz-weiss.jpg

15. SEO-Alt-Text
Schwarz-weißes digitales Poster mit humorvollem Spruch, ideal für ein charmantes Gäste-WC.

16. FAQ
${faq}

17. Cross-Selling-Ideen
Minimalistische Bilderrahmen — um dein neues Poster stilvoll in Szene zu setzen.

18. Verbesserungsvorschläge
Füge ein Bild hinzu, das das Poster in einem eingerichteten Gäste-WC zeigt.

19. Pinterest-Pin zum Listing
Titel: „Hier sitzt du richtig" – Humor im Gäste-WC
Beschreibung: Verleihe deinem Gäste-WC mit diesem Poster Charakter.

20. Pinterest-Bildprompt
A minimalist black-and-white digital poster with the phrase "Hier sitzt du richtig" in a stylish bathroom setting, 2:3 vertical.

21. Instagram-Beitrag
Mach dein Gäste-WC zum Hingucker! #Wandkunst #BadezimmerDeko

22. Facebook-Beitrag
Ein kleines Detail mit großer Wirkung: Welcher humorvolle Spruch darf bei dir nicht fehlen?`;
}

// Die im echten Live-Lauf erfundene FAQ (Wortlaut aus dem Beleg).
const FAQ_ERFUNDEN = `**Wie erhalte ich mein digitales Poster?**
Nach dem Kauf bekommst du einen Download-Link. Einfach herunterladen, ausdrucken und aufhängen – so einfach bringst du Stil in dein Gäste-WC!

**Kann ich die Größe des Posters anpassen?**
Ja, das digitale Format ermöglicht es, die Größe je nach Bedarf anzupassen. Drucke es in deiner Lieblingsgröße aus!

**Ist das Poster für alle Drucker geeignet?**
Das Design ist so konzipiert, dass es mit den meisten Standarddruckern gut funktioniert. Achte auf die Druckeinstellungen, um das beste Ergebnis zu erzielen.

**Kann ich das Poster personalisieren?**
Der Spruch ist festgelegt, aber durch die Wahl des Rahmens kannst du es an deinen Stil anpassen!

**Welche Druckformate sind verfügbar?**
Der Download-Link enthält verschiedene gängige Formate, die auf die meisten Rahmen passen. Details findest du direkt nach dem Kauf.`;

const PRODUKTIDEE_OHNE = `Digitales Gäste-WC-Poster mit dem Spruch „Hier sitzt du richtig" in schwarz-weiß und klarer Typografie.`;

const PRODUKTIDEE_MIT = `Digitales Gäste-WC-Poster mit dem Spruch „Hier sitzt du richtig" in schwarz-weiß und klarer Typografie. Lieferung als PDF-Datei in den Größen 30x40 cm und 50x70 cm, Auflösung 300 dpi.`;

const FAQ_MIT_ANGABEN = `**In welchem Format bekomme ich das Poster?**
Du erhältst dein Poster als PDF-Datei.

**In welchen Größen gibt es das Poster?**
Das Poster ist in den Größen 30x40 cm und 50x70 cm verfügbar.

**Funktioniert das mit meinem Drucker?**
Das Design funktioniert mit den meisten Standarddruckern.

**Enthält der Download auch PNG-Dateien?**
Der Download-Link enthält verschiedene gängige Formate, darunter PNG und SVG.`;

async function runCase(request: ContentRequest, text: string): Promise<{ body: string; attempts: number }> {
  stubText = text;
  stubCalls = 0;
  const outcome = await runWithContextLoyalty(request, async (req) => {
    const { createOpenAIProvider } = await import('./src/ai/providers/openai');
    return createOpenAIProvider().generate(req, {} as never);
  });
  return { body: outcome.result.body, attempts: outcome.attempts };
}

/** Optionaler Beleg-Dump (nur wenn ETSY_FAQ_DUMP_DIR gesetzt ist). */
async function dump(name: string, text: string): Promise<void> {
  const dir = process.env.ETSY_FAQ_DUMP_DIR;
  if (!dir) return;
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}`, text, 'utf8');
}

console.log('\n[0] Prompt-Regel (geht wirklich raus)');
{
  const prompt = buildSystemPrompt('etsy_listing');
  check('Sektion 16 nennt die Vorbedingung (ohne Angaben ganz weglassen)',
    prompt.includes('Sektion 16 KOMPLETT weglassen'));
  check('Sektion 16 nennt die Lieferumfang-Regel (Formate/Größen/Drucker/Download)',
    prompt.includes('LIEFERUMFANG (harte Regel)') &&
      prompt.includes('Dateiformate') && prompt.includes('Download-Link') &&
      prompt.includes('Lieblingsgröße') && prompt.includes('Standarddruckern'));
  check('Alte Hintertür „allgemein beantworten" ist weg',
    !prompt.includes('ausdrücklich allgemein'));
  check('Andere Kanäle unberührt (Pinterest-Prompt ohne Etsy-FAQ-Regel)',
    !buildSystemPrompt('pinterest_pin').includes('LIEFERUMFANG (harte Regel)'));
}

console.log('\n[1] Prüffall 1 — ohne Lieferumfang-Angaben: FAQ entfällt ganz');
{
  // Beleg, dass die neuen Regeln die erfundenen Sätze ÜBERHAUPT erkennen.
  const hits = factViolations(FAQ_ERFUNDEN, PRODUKTIDEE_OHNE);
  check('erfundene FAQ-Sätze werden als Verstoß erkannt',
    hits.includes('FACT:dateiformat-claim') && hits.includes('FACT:download-zusage') &&
      hits.includes('FACT:drucker-zusage') && hits.includes('FACT:groessen-zusage'),
    hits.join(','));

  const { body, attempts } = await runCase(
    { contentType: 'etsy_listing', productIdea: PRODUKTIDEE_OHNE, enforceFacts: true },
    listing(FAQ_ERFUNDEN),
  );
  check('System-Prompt am Anbieter enthält die neue Regel',
    seenSystemPrompt.includes('LIEFERUMFANG (harte Regel)'));
  check('Nutzer-Prompt enthält die Produktidee', seenUserPrompt.includes('Gäste-WC-Poster'));
  check('ein korrigierender Versuch lief (2 Aufrufe)', attempts === 2 && stubCalls === 2, `attempts=${attempts}, calls=${stubCalls}`);
  check('Sektion 16 FAQ ist vollständig weg', !/^\s*16\.\s*FAQ/im.test(body), body.slice(0, 200));
  check('keine erfundene Download-Aussage mehr', !/download/i.test(body));
  check('keine erfundene Größen-Aussage mehr', !/lieblingsgröße/i.test(body));
  check('keine erfundene Drucker-Aussage mehr', !/standarddrucker/i.test(body));
  check('keine erfundene Format-Aussage mehr', !/formate/i.test(body));
  check('Feld 17 und Feld 22 bleiben erhalten',
    body.includes('17. Cross-Selling-Ideen') && body.includes('22. Facebook-Beitrag'));
  check('Dateiname aus Feld 14 bleibt erhalten (kein Fehlalarm auf .jpg)',
    body.includes('gaeste-wc-poster-digital-schwarz-weiss.jpg'));
  await dump('fall1-listing.txt', body);
}

console.log('\n[2] Prüffall 2 — mit genannten Formaten: nur diese Fakten');
{
  const { body, attempts } = await runCase(
    { contentType: 'etsy_listing', productIdea: PRODUKTIDEE_MIT, enforceFacts: true },
    listing(FAQ_MIT_ANGABEN),
  );
  check('FAQ-Sektion bleibt stehen', /^\s*16\.\s*FAQ/im.test(body));
  check('genanntes Format PDF bleibt', /PDF/.test(body));
  check('genannte Größen bleiben', body.includes('30x40 cm') && body.includes('50x70 cm'));
  check('erfundenes Format PNG ist weg', !/PNG/.test(body), body.split('16. FAQ')[1]?.slice(0, 300));
  check('erfundenes Format SVG ist weg', !/SVG/.test(body));
  check('erfundene Drucker-Zusage ist weg', !/Standarddrucker/i.test(body));
  check('erfundener Download-Link ist weg', !/Download-Link/i.test(body));
  const faqTeil = body.slice(body.indexOf('16. FAQ'), body.indexOf('17. Cross-Selling-Ideen'));
  check('genau die zwei belegten Fragen bleiben', (faqTeil.match(/\?/g) ?? []).length === 2,
    `Fragezeichen in der FAQ=${(faqTeil.match(/\?/g) ?? []).length}`);
  check('Retry-Kette lief (2 Aufrufe)', attempts === 2 && stubCalls === 2, `attempts=${attempts}, calls=${stubCalls}`);
  await dump('fall2-listing.txt', body);
}

console.log('\n[3] Kein Fehlalarm: belegte Lieferumfang-Aussagen werden nicht geflaggt');
{
  const nutzer = `${PRODUKTIDEE_MIT} Download als PDF und JPG, Drucker: handelsüblicher Tintenstrahldrucker.`;
  const belegt = `Du erhältst dein Poster als PDF-Datei. Der Download-Link enthält PDF und JPG. Das funktioniert mit deinem Tintenstrahldrucker.`;
  const hits = factViolations(belegt, nutzer);
  const scopeHits = hits.filter((h) =>
    /dateiformat-claim|download-zusage|drucker-zusage|groessen-zusage/.test(h));
  check('belegte Formate/Download/Drucker lösen keinen Verstoß aus', scopeHits.length === 0, scopeHits.join(','));

  const faqBelegt = `16. FAQ
**In welchem Format bekomme ich das Poster?**
Du erhältst dein Poster als PDF-Datei.

17. Cross-Selling-Ideen
Bilderrahmen.`;
  const gestrippt = stripUngroundedEtsyFaq(faqBelegt, nutzer);
  check('belegte FAQ bleibt unverändert', gestrippt === faqBelegt, gestrippt);

  const ohneAngaben = stripUngroundedEtsyFaq(faqBelegt, PRODUKTIDEE_OHNE);
  check('ohne Nutzerangaben fällt die Sektion samt Überschrift weg',
    !ohneAngaben.includes('FAQ') && ohneAngaben.includes('17. Cross-Selling-Ideen'), ohneAngaben);
}

(globalThis as unknown as { fetch: unknown }).fetch = realFetch;
console.log(
  failures === 0
    ? '\nERGEBNIS: GRÜN — beide Prüffälle belegt.'
    : `\nERGEBNIS: ROT — ${failures} Prüfung(en) fehlgeschlagen.`,
);
process.exit(failures === 0 ? 0 : 1);

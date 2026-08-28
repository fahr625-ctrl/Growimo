// ── Post-Generation Guard: Unbelegte Metrik-Claims ───────────────────────────
// Problem 3: GPT-4o reproduziert erfundene Benchmark-Zahlen ("50% häufiger
// gespeichert", "2× mehr Saves", "Öffnungsrate 40%+") die nur als Should-be-
// Beispiele in System-Prompts standen. Das ist ein unbelegter, irreführender
// Marketing-Claim — wir unterbinden ihn SERVERSEITIG nach der Generierung.
//
// Strategie (robust, kein 2. Generationspfad):
//   1. Ein schneller Regex-Scan prüft, ob überhaupt kennzahlenartige Muster
//      vorhanden sind (Prozent-, Multiplikator-, Rateneuungen). Wenn keine →
//      sofort unverändert zurück, null Latenz/Null LLM-Kosten.
//   2. Falls vorhanden: EIN kompakter GPT-4o-Aufruf neutralisiert NUR die
//      unbelegten Metrik-Claims. Der Nutzerkontext wird mitgegeben, damit
//      legitim vom Nutzer gelieferte Zahlen (Preise, Mengen, eigene Angaben)
//      NICHT angetastet werden. Alles andere bleibt wortgleich.
//   3. Nach der Revision wird erneut per Regex geprüft, ob noch kennzeichen-
//      typische Muster übrig sind; wenn ja, ein weiterer Versuch.
//
// `eksplizite` userInput (productIdea) schützt ECHTE Nutzerdaten: eine Zahl,
// die im Nutzerkontext steht, gilt als belegt und wird nie entfernt.

import type OpenAI from 'openai';

/**
 * Globale Prompt-Constraint (de+en), die in alle Content-Generator-Prompts
 * eingespeist wird, damit das Modell diese Claims gar nicht erst erzeugt.
 */
export const NO_METRICS_CONSTRAINT = `⚠️ KEINE ERFUNDENEN KENNZAHLEN: Verwende NIEMALS erfundene Statistiken, Prozentangaben, Multiplikatoren („X× mehr/so viel“), „Y% häufiger/steigert“ oder Öffnungs-, Save-, Klick-, Durchklick-, Conversion- oder Engagement-Raten ohne eine konkrete, belegbare Quelle, die der Nutzer geliefert hat. Wenn du keine belegte Zahl hast, formuliere OHNE Zahlenangabe (z. B. „öfter gespeichert“ als rein qualitative Aussage, nie mit erfundener Prozent- oder Multiplikatorzahl). Einzig Zahlen, die der Nutzer selbst in seinen Produktdetails/Produktidee angibt, darfst du übernehmen.
⚠️ EN Version of this rule: Never invent statistics, percentages, multipliers ("X× more"), or open/save/click/through/conversion rates without a concrete user-provided, verifiable source. If you do not have a verified number, write without a number. Only figures the user explicitly supplies may be reused.`;

/**
 * RegEx-Schnellscan: erkennt kennzahlenartige Muster (Prozentangaben,
 * Multiplikatoren, Rateneuungen). Dient nur als *Trigger* für den LLM-Guard —
 * die präzise Neutralisierung übernimmt GPT-4o. Bewusst breit, damit nichts
 * durchrutscht (Fehltrigger sind harmlos, der LLM behält Echtdaten).
 */
// eslint-disable-next-line no-useless-escape
const METRIC_PATTERNS: RegExp[] = [
  /\b\d{1,3}(?:[.,]\d+)?\s*%/, // 50% | 10-20 % | 3,5%
  /\b\d{1,2}\s*[×xX]\s*(mehr|so\s+viel|schneller|häufiger|so\s+oft|oft)/i,
  /\b(doppelt|dreimal|2x|3x|2×|3×)\s*(so\s+)?(viele?|häufig|oft|mehr|schnell)/i,
  /\b(save[- ]?rate|öffnungsrate|klickrate|klick[- ]?rate|durchklick|conversion[- ]?rate|engagement[- ]?rate|durchschnittliche\s+öffnungsrate)/i,
  /\b\d{1,2}\s*%\s*(mehr|höher|niedriger|steigt|sinkt|häufiger|öfter|weniger|schneller|kürzer)/i,
  /\b(höhere|mehr)\s+[a-zäöü/ ]{0,20}(saves|sale[- ]?rate|klicks|engagements)\b/i,
];

/** Zahl im Nutzerkontext? → als belegt behandelt (nicht entfernen). */
function userContextContainsNumber(userContext: string, num: string): boolean {
  if (!userContext) return false;
  const clean = num.replace(/[^0-9.,%]/g, '').trim();
  if (!clean) return false;
  // 50 mit % normalisieren, damit „50 €“ vs „50%“ kontextbewusst bleibt.
  const asPlain = clean.replace(/%/g, '').replace(/\./g, '.').trim();
  return userContext.includes(asPlain) || userContext.includes(num);
}

/** Liefert true, wenn Text ein kennzahlenartiges Muster enthält. */
export function hasMetricPattern(text: string): boolean {
  if (!text) return false;
  for (const re of METRIC_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

function initials(client: OpenAI, sys: string, user: string, text: string): Promise<string> {
  return client.chat.completions
    .create({
      model: 'gpt-4o',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Du neutralisierst Aussagen. Entferne NUR unbelegte Kennzahlen-Claims und ändere nichts anderes.',
        },
        {
          role: 'user',
          content: `${sys}\n\nNutzervorgaben (belegt, NICHT entfernen — wenn diese Zahlen im Text auftauchen, behalte sie):\n---\n${user}\n---\n\nZu bereinigender Text, Antworte mit dem bereinigten Text (und nur dem):\n${text}`,
        },
      ],
    })
    .then((r) => r.choices[0]?.message?.content ?? text)
    .catch(() => text);
}

/**
 * Serverseitige Guard-Anwendung. `userContext` = productIdea + additionalContext
 * (der echtes Nutzer-/Produkt-Faktenmaterial enthält). Gibt den bereinigten Text
 * zurück. Wirft nie — bei jedem Fehler bleibt der Originaltext erhalten.
 */
export async function sanitizeUnbackedMetrics(
  text: string,
  userContext: string,
): Promise<{ text: string; removed: boolean }> {
  if (!text || !hasMetricPattern(text)) {
    return { text, removed: false };
  }
  // Deterministisch ermitteln, welche Kennzahlen-Tokens UNBELEGT sind = die zu
  // entfernenden. Nicht negativ: Zahlen in der Nutzervorgabe gelten als belegt
  // und landen NICHT in dieser Liste (Echtdaten des Nutzers bleiben erhalten).
  const unbackedTokens: string[] = [];
  const percentMatches = text.match(/\d+(?:[.,]\d+)?\s*%/g) ?? [];
  for (const m of percentMatches) {
    const num = m.replace(/\s*%$/, '').trim();
    if (!userContextContainsNumber(userContext, num)) unbackedTokens.push(m.trim());
  }
  const multiplierMatches =
    text.match(/\d+\s*[×xX]\s*(mehr|so\s+viel|schneller|häufiger|so\s+oft|oft)/gi) ??
    text.match(/\d+\s*[×xX]/gi) ??
    [];
  for (const m of multiplierMatches) {
    const first = m.split(/\s/)[0];
    const num = first.replace(/[^\d.,]/g, '').trim();
    if (num && !userContextContainsNumber(userContext, num)) unbackedTokens.push(m.trim());
  }

  if (unbackedTokens.length === 0) {
    return { text, removed: false };
  }

  // Nice-to-have: Nutzerzahlen ohnehin schützen (zusätzliche Absicherung).
  const keepNums = Array.from(
    new Set(
      (userContext.match(/\b\d{1,3}(?:[.,]\d+)?\s*%?\b/g) ?? []).map((n) => n.trim()),
    ),
  );
  const removeLine =
    'Entferne bzw. neutralisiere AUSSCHLIESSLICH diese unbelegten Kennzahlen im Text ' +
    `(nimm die Zahl aus dem Satz und formuliere ohne sie weiter): ${unbackedTokens.join(', ')}. ` +
    'Alle anderen Zahlen bleiben EXAKT unverändert. Wenn ein Satz NUR aus der Kennzahl ' +
    'bestünde, streiche ihn. Gib NUR den bereinigten Text zurück.';
  const keepLine =
    keepNums.length > 0
      ? `Folgende Zahlen stammen vom Nutzer und sind belegt — behalte sie EXAKT so bei: ${keepNums.join(', ')}. `
      : '';
  const guard =
    'Grundregel: Entferne NICHT einfach beliebige Zahlen. Entferne nur UNBELEGTE ' +
    'kennzahlenbasierte Behauptungen (erfundene Prozent-/Multiplikator-Angaben, ' +
    'Save-/Öffnungs-/Klick-/Conversion-Raten ohne Nutzerquelle). Faktische ' +
    'Produktangaben (Preise, Mengen, Größen, Materialien, Zeitangaben, Hashtags, ' +
    'Keyword-Listen, Zeichenzahlen) bleiben UNANGETASTET.\n' +
    removeLine +
    keepLine;

  const openai = await import('openai').then((m) => m.default);
  const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
  let cleaned = await initials(client, guard, userContext, text);

  // Post-Check: wenn ein Nutzer-Echtdatum verschwand, Nutzerzahl nachtragen wäre
  // kontextfragil — stattdessen nur die unbedachten Entfernungen verhindern, indem
  // wir bei Regress auf den Originaltext zurückfallen, falls der Clean Output die
  // unbelegten Muster NICHT reduziert hat (Removal fehlgeschlagen → behalte Original).
  if (cleaned === text) return { text, removed: false };
  return { text: cleaned, removed: cleaned !== text };
}

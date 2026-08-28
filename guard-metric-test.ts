// ── Problem 3 test: Post-Generation-Guard entfernt/neutralisiert unbelegte
// Metrik-Claims ("50% häufiger gespeichert") mit echtem GPT-4o, löscht aber
// NICHT legitim vom Nutzer gelieferte Zahlen.
import { sanitizeUnbackedMetrics, hasMetricPattern } from './src/ai/metric-guard';

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  if (!cond) { failures++; console.log('FAIL:', name, '—', detail); }
  else console.log('PASS:', name);
}

async function main() {
  // 1. Unbelegter Claim (das Owner-Beispiel "50% häufiger gespeichert")
  const badBody =
    '6. Designempfehlung\nBoho-Warm — diese Designs werden 50% häufiger gespeichert.\n' +
    '7. Pin-Kategorie\nDIY & Handwerk — Pins hier erzielen 2x mehr Saves.\n' +
    '8. Bildkonzept\nEin warmes Bild mit Keramikvasen.';
  check('hasMetricPattern detects unbacked claim', hasMetricPattern(badBody), badBody);
  const cleaned = await sanitizeUnbackedMetrics(badBody, 'Handgemachte Keramikvase aus nachhaltigem Ton, 29 Euro.');
  setTimeout(() => {}, 0);
  console.log('\n--- cleaned output ---\n' + cleaned.text + '\n----------------------');
  // Der Claim soll entfernt/neutralisiert sein: KEINE 50% / 2x mehr Saves mehr,
  // und der Text soll noch sinnvoll (nicht komplett leer) sein.
  const stillUnbacked = /50\s*%|2x mehr Saves|2× mehr Saves/i.test(cleaned.text);
  check('unbacked "50% häufiger" removed/neutralized', !stillUnbacked, cleaned.text);
  check('output still non-trivial', cleaned.text.length > 40, `len=${cleaned.text.length}`);

  // 2. Legitime Nutzer-Metrik MUSS erhalten bleiben
  const userBody =
    'Dieses Produkt ist laut Marktforschung um 25% im Preis gesenkt und wird von 40.000 Kunden genutzt.\n' +
    '6. Designempfehlung\nEin klares, minimalistisches Design passend zum Produkt.';
  const context = 'Unser Produkt ist um 25% reduziert, 40.000 Kunden nutzen es bereits.';
  const cleaned2 = await sanitizeUnbackedMetrics(userBody, context);
  console.log('\n--- user-metric output ---\n' + cleaned2.text + '\n--------------------------');
  check('user-provided 25% preserved', cleaned2.text.includes('25%'), cleaned2.text);
  check('user-provided 40.000 preserved', cleaned2.text.includes('40.000'), cleaned2.text);

  // 3. Kein Metrik-Muster -> Guard greift gar nicht ein (0 LLM-Calls, unverändert)
  const cleanBody = '6. Designempfehlung\nEin warmes, minimalistisches Design mit Naturtönen.';
  const exact = await sanitizeUnbackedMetrics(cleanBody, 'Keramikvase');
  check('no-metric body passes through unchanged', exact.text === cleanBody && !exact.removed, exact.text);

  if (failures > 0) { console.log(`\n${failures} FAILURES`); process.exit(1); }
  console.log('\nALL METRIC-GUARD TESTS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });

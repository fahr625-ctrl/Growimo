// Kleiner Patch für die zu großen i18n-Dateien (EditFile-argv-Limit umgangen).
import { readFileSync, writeFileSync } from 'node:fs';

const deAdd = `  legal_privacy_contact_body: 'Fragen zum Datenschutz richtest du an:',
  // ── ENTWURF 2026-10-24: Widerruf / vorzeitiger Beginn im Checkout ──────────
  // Wortlaut = gesetzliche Voraussetzung aus § 356 Abs. 4/5 BGB (ausdrückliches
  // Verlangen + Kenntnisnahmebestätigung). Nicht kürzen: eine pauschale
  // „Widerrufsrecht erlischt"-Klausel ohne diese Zustimmung ist unwirksam.
  widerruf_consent_label:
    'Ich verlange ausdrücklich, dass Growimo mit der Erbringung der Leistung bereits vor Ablauf der 14-tägigen Widerrufsfrist beginnt, und bestätige, dass ich dadurch mein Widerrufsrecht verliere.',
  widerruf_consent_hint:
    'Das Widerrufsrecht erlischt, sobald die Leistung vollständig erbracht ist (§ 356 Abs. 5 BGB). Bis dahin bleibt es bestehen; bei einem Widerruf zahlst du für die bereits erbrachten Leistungen anteiligen Wertersatz (§ 357a Abs. 1 BGB). Einzelheiten regelt die Widerrufsbelehrung.',
  widerruf_consent_required:
    'Bitte bestätige den Beginn vor Ablauf der Widerrufsfrist, um das Abo abzuschließen.',
} as const;`;

const enAdd = `  legal_privacy_contact_body: 'Questions about data protection can be directed to:',
  // ── DRAFT 2026-10-24: right of withdrawal / early start in checkout ────────
  // Wording mirrors the statutory requirement (Sec. 356(4)/(5) German Civil
  // Code: express request + acknowledgement). Do not shorten: a blanket
  // "the right of withdrawal expires" clause without this consent is void.
  widerruf_consent_label:
    'I expressly request that Growimo begins providing the service before the 14-day withdrawal period has expired, and I confirm that I thereby lose my right of withdrawal.',
  widerruf_consent_hint:
    'The right of withdrawal expires once the service has been fully performed (Sec. 356(5) German Civil Code, BGB). Until then it remains in force; if you withdraw, you pay proportionate compensation for the service already provided (Sec. 357a(1) BGB). Details are set out in the withdrawal policy.',
  widerruf_consent_required:
    'Please confirm that the service may begin before the withdrawal period expires in order to complete the subscription.',
}`;

const deTail = `  legal_privacy_contact_body: 'Fragen zum Datenschutz richtest du an:',
} as const;`;
const enTail = `  legal_privacy_contact_body: 'Questions about data protection can be directed to:',
}`;

function patch(path: string, tail: string, add: string) {
  const src = readFileSync(path, 'utf8');
  if (src.includes('widerruf_consent_label')) {
    console.log(`SKIP ${path} (already patched)`);
    return;
  }
  if (!src.includes(tail)) {
    console.log(`FAIL ${path} (tail not found)`);
    process.exitCode = 1;
    return;
  }
  // letztes Vorkommen ersetzen
  const idx = src.lastIndexOf(tail);
  const out = src.slice(0, idx) + add + src.slice(idx + tail.length);
  writeFileSync(path, out, 'utf8');
  console.log(`OK ${path}`);
}

patch('src/i18n/de.ts', deTail, deAdd);
patch('src/i18n/en.ts', enTail, enAdd);

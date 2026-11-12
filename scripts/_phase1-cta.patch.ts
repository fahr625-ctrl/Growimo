// Phase 1: fehlenden i18n-Key + bereichsabhaengiges CTA-Label.
import { readFileSync, writeFileSync } from 'node:fs';

function addKey(file: string, value: string): void {
  let src = readFileSync(file, 'utf8');
  const anchor = /^(  results_retry_failed:.*)$/m;
  if (!anchor.test(src)) throw new Error('anchor missing in ' + file);
  src = src.replace(anchor, (_m, line: string) => `${line}\n  strategy_open_module: '${value}',`);
  writeFileSync(file, src);
  console.log(file + ' ok');
}

addKey('src/i18n/de.ts', 'Zum Modul');
addKey('src/i18n/en.ts', 'Open module');

const file = 'src/routes/app/new-project.tsx';
let src = readFileSync(file, 'utf8');
const old = '            {t.strategy_create_btn}\n';
if (!src.includes(old)) throw new Error('CTA anchor missing');
const label = `            {/* Phase 1: eigener Button-Text je Bereich (Pinterest/Etsy). */}
            {selectedTypes.length === 1 && selectedTypes[0] === 'pinterest_pin'
              ? t.strategy_create_btn_pinterest
              : selectedTypes.length === 1 && selectedTypes[0] === 'etsy_listing'
                ? t.strategy_create_btn_etsy
                : t.strategy_create_btn}
`;
src = src.replace(old, label);
writeFileSync(file, src);
console.log(file + ' CTA ok');

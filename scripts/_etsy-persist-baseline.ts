// Update the frozen typecheck baseline for the ONE pre-existing error whose
// MESSAGE changed: src/ai/server.ts TS2345 (ServerFn generic mismatch on
// generateContentServer). The validator now also returns runKey/persistToLibrary,
// so the type text inside the message is longer — same file, same error code,
// same cause. The baseline key includes the message, so the entry must be
// renamed or the ratchet reports it as "new". Total stays 55.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const raw = execSync('bunx tsc --noEmit -p tsconfig.gate.json 2>&1 || true', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const cur = raw
  .split('\n')
  .filter((l) => /error TS/.test(l))
  .map((l) => {
    const m = l.match(/^([^(]+)\([0-9]+,[0-9]+\): error (TS[0-9]+): (.*)$/);
    return m ? `${m[1]}\t${m[2]}\t${m[3]}` : null;
  })
  .filter((l): l is string => Boolean(l))
  .sort();

const basePath = 'scripts/typecheck-baseline.txt';
const base = readFileSync(basePath, 'utf8').split('\n').filter((l) => l.length > 0);
const curSet = new Set(cur);
const baseSet = new Set(base);

const gone = base.filter((l) => !curSet.has(l));
const added = cur.filter((l) => !baseSet.has(l));

console.log('baseline entries:', base.length, 'current:', cur.length);
console.log('gone:', gone.length, 'added:', added.length);
for (const g of gone) console.log('GONE:', g.slice(0, 120));
for (const a of added) console.log('ADDED:', a.slice(0, 120));

const isTarget = (l: string) => l.startsWith('src/ai/server.ts\tTS2345\t');
if (gone.length === 1 && added.length === 1 && isTarget(gone[0]) && isTarget(added[0])) {
  const next = base.map((l) => (l === gone[0] ? added[0] : l)).sort();
  writeFileSync(basePath, next.join('\n') + '\n');
  console.log('OK baseline umbenannt, Anzahl unverändert:', next.length);
} else {
  console.log('KEINE Änderung geschrieben (Bedingung nicht erfüllt).');
}

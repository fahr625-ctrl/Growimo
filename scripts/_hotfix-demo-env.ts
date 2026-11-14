// Leitet aus .env eine minimale DEMO-DB-Env ab (growimo_demo statt neondb).
// Schreibt NUR DATABASE_URL nach /tmp/hotfix-demo.env (chmod 600). Kein Echo der URL.
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';

const raw = readFileSync('.env', 'utf8');
const line = raw.split('\n').find((l) => l.startsWith('DATABASE_URL='));
if (!line) throw new Error('DATABASE_URL fehlt in .env');
let url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
url = url.replace(/\/neondb(\?|$)/, '/growimo_demo$1');
if (!/\/growimo_demo(\?|$)/.test(url)) throw new Error('Ableitung fehlgeschlagen — kein /growimo_demo');
const out = process.argv[2] ?? '/tmp/hotfix-demo.env';
writeFileSync(out, `DATABASE_URL=${url}\n`);
chmodSync(out, 0o600);
const u = new URL(url);
console.log(`demo-env -> ${out} (host=${u.hostname}, db=${u.pathname.slice(1)})`);

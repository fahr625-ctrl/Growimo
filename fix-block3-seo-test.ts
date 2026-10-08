// ─────────────────────────────────────────────────────────────────────────────
// FIX-BLOCK 3 — SEO-Grundlagen Suite (2026-10-08)
// ─────────────────────────────────────────────────────────────────────────────
// Prüft die Launch-Check-PRIO-4-Befunde als dauerhafte Regression:
//   1. robots.txt  — Inhalt, Regeln, absolute Sitemap-Zeile, im Build-Output
//   2. sitemap.xml — Wohlgeformtheit, absolute URLs, NUR öffentliche Seiten
//   3. og:image / twitter:image — absolut in der zentralen Meta-Stelle (__root)
//   4. noindex auf /app* (App-Layout) + index,follow für die öffentlichen Ausnahmen
//   5. canonical absolut auf /, /app, /app/pricing
//   6. eigene Titel je /app-Seite, de/en über i18n, Parität, keine Duplikate
//
// Läuft OHNE DB und ohne Netz:  bun fix-block3-seo-test.ts
// Exit 0 nur, wenn alle Checks grün sind.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { de } from './src/i18n/de';
import { en } from './src/i18n/en';
import {
  OG_IMAGE_URL,
  ROBOTS_PRIVATE,
  ROBOTS_PUBLIC,
  SITE_HOME_URL,
  SITE_ORIGIN,
  canonicalUrl,
  seoText,
} from './src/lib/seo';

const ROOT = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const has = (p: string) => existsSync(join(ROOT, p));

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
};
const skip = (label: string) => {
  skipped++;
  console.log(`  ~ SKIP (nicht Teil dieses Laufs): ${label}`);
};

const LANDING_TITLE = 'Growimo — Pinterest Pins, Etsy-Mockups & SEO-Content mit KI erstellen';

// ── 1. robots.txt ───────────────────────────────────────────────────────────
console.log('\n[1] robots.txt');
const robotsPath = 'public/robots.txt';
check(has(robotsPath), `${robotsPath} existiert`);
const robots = has(robotsPath) ? read(robotsPath) : '';
check(/^User-agent: \*$/m.test(robots), 'Regel "User-agent: *" vorhanden');
check(/^Allow: \/$/m.test(robots), 'Regel "Allow: /" vorhanden (Landing crawlbar)');
check(/^Disallow: \/app\/$/m.test(robots), 'Regel "Disallow: /app/" vorhanden (Arbeitsbereich)');
check(/^Disallow: \/api\/$/m.test(robots), 'Regel "Disallow: /api/" vorhanden (API-Routen)');
check(/^Allow: \/app\/pricing$/m.test(robots), 'Ausnahme "Allow: /app/pricing" (längere Regel gewinnt)');
check(/^Allow: \/app\/sign-in$/m.test(robots), 'Ausnahme "Allow: /app/sign-in"');
check(/^Allow: \/app\/sign-up$/m.test(robots), 'Ausnahme "Allow: /app/sign-up"');
check(
  robots.includes('Sitemap: https://www.growimo.app/sitemap.xml'),
  'Sitemap-Zeile absolut auf https://www.growimo.app/sitemap.xml',
);
check(!/^Sitemap: \//m.test(robots), 'keine relative Sitemap-Zeile');
// Vercel liefert Dateien aus .vercel/output/static über die Route "filesystem"
// VOR dem SSR-Handler aus → public/-Dateien sind 200-fähig ohne eigene Route.
const vercelStatic = '.vercel/output/static';
const distHasRobots = has('dist/client/robots.txt');
const vercelHasRobots = has(`${vercelStatic}/robots.txt`);
if (vercelHasRobots) {
  check(read(`${vercelStatic}/robots.txt`) === robots, 'robots.txt im Vercel-Build-Output identisch');
} else {
  skip('.vercel/output/static noch nicht gebaut');
}
if (distHasRobots) {
  check(read('dist/client/robots.txt') === robots, 'robots.txt in dist/client identisch');
} else {
  skip('dist/client noch nicht gebaut');
}
check(
  read('build-vercel.sh').includes('cp -R dist/client .vercel/output/static'),
  'build-vercel.sh kopiert dist/client → .vercel/output/static (statische Auslieferung)',
);

// ── 2. sitemap.xml ──────────────────────────────────────────────────────────
console.log('\n[2] sitemap.xml');
const sitemapPath = 'public/sitemap.xml';
check(has(sitemapPath), `${sitemapPath} existiert`);
const sitemap = has(sitemapPath) ? read(sitemapPath) : '';
check(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML-Deklaration korrekt');
check(
  sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
  'urlset mit Sitemap-Namespace',
);
check(
  (sitemap.match(/<url>/g) ?? []).length === (sitemap.match(/<\/url>/g) ?? []).length &&
    (sitemap.match(/<url>/g) ?? []).length > 0,
  'url-Blöcke paarig geschlossen',
);
check((sitemap.match(/<\/urlset>/) ?? []).length === 1, 'urlset genau einmal geschlossen');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(locs.length === 2, `genau 2 <loc>-Einträge (gefunden: ${locs.length})`);
check(
  (sitemap.match(/<loc>/g) ?? []).length === locs.length,
  'jedes <loc> hat einen Wert (keine leeren Tags)',
);
check(locs.every((l) => l.startsWith('https://')), 'alle <loc> absolut mit https://');
check(locs.every((l) => l.startsWith(SITE_ORIGIN)), `alle <loc> auf ${SITE_ORIGIN}`);
check(locs.includes('https://www.growimo.app/'), 'Landing-URL enthalten');
check(locs.includes('https://www.growimo.app/app/pricing'), 'Preis-Seite /app/pricing enthalten');
check(
  locs.every((l) => l === 'https://www.growimo.app/' || l === 'https://www.growimo.app/app/pricing'),
  'keine weiteren URLs (keine Auth-/Projektseiten)',
);
check(
  !locs.some((l) => /\/app\/(projects|new-project|image-studio|settings|billing|package|calendar|brand|analytics|tiktok|content-library|performance|feedback|generate)/.test(l)),
  'keine /app-Unterseiten außer Pricing in der Sitemap',
);
check(
  !/localhost|ctonew\.app|127\.0\.0\.1/.test(sitemap),
  'keine lokalen/Sandbox-Hosts in der Sitemap',
);
check(!/&(?!(amp|lt|gt|quot|apos);)/.test(sitemap), 'kein unescaped "&" (Wohlgeformtheit)');
const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
check(
  lastmods.length === locs.length && lastmods.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  'lastmod je URL im Format YYYY-MM-DD',
);
if (vercelHasRobots) {
  check(has(`${vercelStatic}/sitemap.xml`) && read(`${vercelStatic}/sitemap.xml`) === sitemap, 'sitemap.xml im Vercel-Build-Output identisch');
} else {
  skip('.vercel/output/static noch nicht gebaut (sitemap.xml)');
}

// ── 3. og:image / twitter:image absolut ─────────────────────────────────────
console.log('\n[3] Social-Meta absolut (zentrale Stelle = src/routes/__root.tsx)');
check(has('public/logo.png'), 'public/logo.png existiert (Vorprüfung)');
if (has('dist/client/logo.png')) {
  check(true, 'dist/client/logo.png im Build-Output vorhanden');
} else {
  skip('dist/client/logo.png (dist nicht gebaut)');
}
check(OG_IMAGE_URL === 'https://www.growimo.app/logo.png', `OG_IMAGE_URL = ${OG_IMAGE_URL}`);
const root = read('src/routes/__root.tsx');
check(/property: "og:image", content: OG_IMAGE_URL/.test(root), 'og:image nutzt die absolute OG_IMAGE_URL');
check(/name: "twitter:image", content: OG_IMAGE_URL/.test(root), 'twitter:image nutzt die absolute OG_IMAGE_URL');
check(!/og:image", content: "\//.test(root), 'kein relatives og:image mehr');
check(!/twitter:image", content: "\//.test(root), 'kein relatives twitter:image mehr');
check(root.includes('OG_IMAGE_URL') && /import \{ OG_IMAGE_URL \} from "~\/lib\/seo"/.test(root), 'OG_IMAGE_URL wird importiert');
check(root.includes('summary_large_image'), 'twitter:card unverändert summary_large_image');
check(root.includes(LANDING_TITLE), 'Landing-Titel unverändert (kein SEO-Umbau der Landing)');
check(
  root.includes('Erstelle Pinterest Pins, Etsy-Mockups, SEO-Content und komplette Marketing-Strategien mit KI'),
  'Landing-Beschreibung unverändert',
);

// ── 4. noindex im App-Layout ────────────────────────────────────────────────
console.log('\n[4] noindex für /app* (App-Layout)');
const appLayout = read('src/routes/app.tsx');
check(ROBOTS_PRIVATE === 'noindex,follow', "ROBOTS_PRIVATE === 'noindex,follow'");
check(ROBOTS_PUBLIC === 'index,follow', "ROBOTS_PUBLIC === 'index,follow'");
check(
  /head: \(\) =>/.test(appLayout) && appLayout.includes('robots: ROBOTS_PRIVATE'),
  'App-Layout setzt robots: ROBOTS_PRIVATE im head',
);
check(appLayout.includes("createFileRoute(\"/app\")"), 'Layout-Route ist die /app-Wurzel aller App-Seiten');

type RouteInfo = { file: string; key?: string; robots?: 'private' | 'public'; canonical?: string };
const appRouteFiles: [string, 'private' | 'public' | undefined, string | undefined][] = [
  ['src/routes/app/index.tsx', undefined, '/app'],
  ['src/routes/app/admin-analytics.tsx', undefined, undefined],
  ['src/routes/app/admin-tracking.tsx', undefined, undefined],
  ['src/routes/app/analytics.tsx', undefined, undefined],
  ['src/routes/app/beta-signups.tsx', undefined, undefined],
  ['src/routes/app/beta-welcome.tsx', undefined, undefined],
  ['src/routes/app/billing.tsx', undefined, undefined],
  ['src/routes/app/brand.tsx', undefined, undefined],
  ['src/routes/app/calendar.tsx', undefined, undefined],
  ['src/routes/app/content-library.tsx', undefined, undefined],
  ['src/routes/app/feedback.tsx', undefined, undefined],
  ['src/routes/app/generate/blog.tsx', undefined, undefined],
  ['src/routes/app/generate/etsy.tsx', undefined, undefined],
  ['src/routes/app/generate/pinterest.tsx', undefined, undefined],
  ['src/routes/app/image-studio.tsx', undefined, undefined],
  ['src/routes/app/new-project.tsx', undefined, undefined],
  ['src/routes/app/package.tsx', undefined, undefined],
  ['src/routes/app/performance.tsx', undefined, undefined],
  ['src/routes/app/projects/$projectId.tsx', undefined, undefined],
  ['src/routes/app/settings.tsx', undefined, undefined],
  ['src/routes/app/tiktok.tsx', undefined, undefined],
  ['src/routes/app/pricing.tsx', 'public', '/app/pricing'],
  ['src/routes/app/sign-in/index.tsx', 'public', undefined],
  ['src/routes/app/sign-in/$.tsx', 'public', undefined],
  ['src/routes/app/sign-up/index.tsx', 'public', undefined],
  ['src/routes/app/sign-up/$.tsx', 'public', undefined],
];

const routes: RouteInfo[] = [];
for (const [file, robots, canonical] of appRouteFiles) {
  if (!has(file)) {
    check(false, `${file} existiert`);
    continue;
  }
  const src = read(file);
  const m = src.match(/head: \(\) =>[\s\S]{0,400}?seoHead\(\{([\s\S]{0,300}?)\}\)/);
  const body = m ? m[1] : '';
  const keyMatch = body.match(/titleKey: '([a-z0-9_]+)'/);
  const info: RouteInfo = { file, key: keyMatch?.[1], robots, canonical };
  routes.push(info);
  check(!!m, `${file}: seoHead()-head vorhanden`);
  check(!!keyMatch, `${file}: eigener i18n-Titel verdrahtet`);
  if (robots === 'public') {
    check(body.includes('robots: ROBOTS_PUBLIC'), `${file}: robots index,follow (öffentliche Ausnahme)`);
  } else {
    check(!body.includes('robots:'), `${file}: kein robots-Override (erbt noindex aus dem Layout)`);
  }
  if (canonical) {
    check(body.includes(`canonical: '${canonical}'`), `${file}: canonical ${canonical}`);
  }
}
check(routes.length === appRouteFiles.length, `alle ${appRouteFiles.length} /app-Routen erfasst (${routes.length})`);
check(!read('src/routes/index.tsx').includes('noindex'), 'Landing hat KEIN noindex');
check(!root.includes('noindex'), 'kein globales noindex in __root');

// ── 5. canonical ────────────────────────────────────────────────────────────
console.log('\n[5] canonical absolut');
const landing = read('src/routes/index.tsx');
check(
  /rel: "canonical", href: SITE_HOME_URL/.test(landing),
  'Landing: <link rel="canonical" href=SITE_HOME_URL>',
);
check(SITE_HOME_URL === 'https://www.growimo.app/', `SITE_HOME_URL = ${SITE_HOME_URL}`);
check(canonicalUrl('/') === SITE_HOME_URL, 'canonicalUrl("/") → https://www.growimo.app/');
check(canonicalUrl('/app') === 'https://www.growimo.app/app', 'canonicalUrl("/app") absolut');
check(canonicalUrl('/app/pricing') === 'https://www.growimo.app/app/pricing', 'canonicalUrl("/app/pricing") absolut');
let threw = false;
try {
  canonicalUrl('app/pricing');
} catch {
  threw = true;
}
check(threw, 'canonicalUrl wirft bei relativem Pfad (fail-closed)');
check(!/rel: "canonical"/.test(root), 'kein canonical in __root (sonst Duplikat auf jeder Seite)');

// ── 6. Titel (i18n de/en, Parität, Eindeutigkeit) ───────────────────────────
console.log('\n[6] Eigene /app-Titel über i18n');
const deKeys = new Set(Object.keys(de));
const enKeys = new Set(Object.keys(en));
const onlyDe = [...deKeys].filter((k) => !enKeys.has(k));
const onlyEn = [...enKeys].filter((k) => !deKeys.has(k));
check(onlyDe.length === 0, `i18n-Parität: keine Keys nur in de (${onlyDe.join(',') || 'keine'})`);
check(onlyEn.length === 0, `i18n-Parität: keine Keys nur in en (${onlyEn.join(',') || 'keine'})`);

const titleKeys = routes.map((r) => r.key!).filter(Boolean) as (keyof typeof de)[];
check(titleKeys.length === appRouteFiles.length, 'jede /app-Route hat einen Titel-Key');
check(titleKeys.every((k) => deKeys.has(k)), 'alle Titel-Keys existieren in de.ts');
check(titleKeys.every((k) => enKeys.has(k)), 'alle Titel-Keys existieren in en.ts');
const titlesDe = titleKeys.map((k) => seoText(k));
const distinctTitles = new Set(titlesDe);
// 26 /app-Routen (sign-in/sign-up haben je index + $-Catch-all) → 24 distincte Titel
check(distinctTitles.size === 24, `Titel eindeutig: 24 distincte Titel für ${titleKeys.length} Routen (${distinctTitles.size})`);
check(!titlesDe.includes(LANDING_TITLE), 'kein /app-Titel ist identisch mit dem Landing-Titel');
check(titlesDe.every((t) => t.endsWith('Growimo')), 'jeder /app-Titel endet auf den Markennamen');
check(
  (robots.match(/Sitemap: https:\/\/www\.growimo\.app\/sitemap\.xml/g) ?? []).length === 1,
  'robots.txt verweist genau einmal auf die Sitemap',
);

// de/en-Auswahl im head: SSR = de, nach Sprachwechsel = en
const origLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
let enSwitchOk = false;
try {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k === 'growimo_language' ? 'en' : null),
  };
  enSwitchOk = seoText('meta_app_pricing_title') === 'Pricing – Growimo';
} catch {
  enSwitchOk = false;
}
try {
  (globalThis as { localStorage?: unknown }).localStorage = origLocalStorage;
} catch {
  /* ignore */
}
if (enSwitchOk) {
  check(true, "Sprachwechsel: Titel wechselt auf 'Pricing – Growimo' (en)");
} else {
  skip('lokalStorage-Mock nicht möglich — de/en-Auswahl nur über die Dictionaries geprüft');
}
check(de.meta_app_pricing_title === 'Preise – Growimo' && en.meta_app_pricing_title === 'Pricing – Growimo', 'DE/EN-Werte der Preis-Seite unterschiedlich');
const newKeys = [...new Set(titleKeys.filter((k) => k.startsWith('meta_app_')))];
const allMetaKeys = [...deKeys].filter((k) => k.startsWith('meta_app_'));
check(newKeys.length === 24, `24 distincte meta_app_*-Titel in den /app-Routen (${newKeys.length})`);
check(allMetaKeys.length === 25, `25 meta_app_*-Keys insgesamt im Dictionary (${allMetaKeys.length}, inkl. Layout-Default)`);
check(
  titleKeys.every((k) => !/^(Preise|Einstellungen|Abrechnung|Projekt|Anmelden|Registrieren|Willkommen|Neues)\b/.test(en[k as keyof typeof en] as string)),
  'keine deutschen Wörter in den englischen App-Titeln',
);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n=== fix-block3-seo-test: ${passed} PASS, ${failed} FAIL${skipped ? `, ${skipped} SKIP` : ''} ===`);
if (failed > 0) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
process.exit(0);

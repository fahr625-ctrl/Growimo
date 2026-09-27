// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 (Prod-Origin) — INTEGRATION: echte Checkout-/Portal-Sessions
// ─────────────────────────────────────────────────────────────────────────────
// Usage (Repo-Wurzel, frischer `bun run build`, echte Test-DB + Testmodus-Key):
//   bun --env-file=.env stripe-origin-integration-test.ts
//
// Was bewiesen wird: die Rückkehr-URLs einer WIRKLICH erzeugten
// Stripe-Checkout-Session (und der Portal-`return_url`) kommen aus der
// Anfrage-Origin des Requests — nicht mehr aus einem fest verdrahteten
// `http://localhost:3000` (Bug 1). Vorher hätte jeder der Fälle unten
// localhost-URLs geliefert, weil PUBLIC_SITE_URL in Production nicht gesetzt ist.
//
// Aufbau: zwei lokale Instanzen von `stripe83-local-server.ts` (dist-Build),
// Instanz A OHNE PUBLIC_SITE_URL, Instanz B MIT (Priorität der Env).
// ─────────────────────────────────────────────────────────────────────────────
import { toJSONAsync } from 'seroval';
import { getDb } from './src/db/index';
import { qGetSubscriptionByStripeId, qUpsertSubscription } from './src/db/queries';

const RUN = Date.now().toString(36).slice(-6);
const PORT_A = Number(process.env.ORIGIN_E2E_PORT_A ?? 3199);
const PORT_B = PORT_A + 1;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;

// ServerFn-IDs (Quellort-stabil, identisch zum 8.3c-E2E — nach dem Build verifiziert).
const FN_CHECKOUT = 'a4b324efe2ab35926848c9344b3c872eabb6dc48d1b0f7e38cb26ff946fade3f';
const FN_PORTAL = '89ea514fb0d9a98f1f71f547acb9b6766f3b8a629eb93f6215ac779e285fcff1';

const SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const TEST_USER = `user_origin_${RUN}`;
const SYNTH_SUB = `sub_origin_${RUN}`;
const sql = getDb();

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};
const skip = (label: string) => {
  skipped += 1;
  console.log(`  – SKIP: ${label}`);
};

async function spawnServer(port: number, extraEnv: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: [process.execPath, '--env-file=/tmp/e2e-child.env', `${import.meta.dir}/stripe83-local-server.ts`],
    cwd: '/tmp',
    env: {
      PATH: '/usr/bin:/bin:/usr/local/bin',
      HOME: process.env.HOME ?? '/home/agent-lead',
      PORT: String(port),
      ...(SECRET_KEY ? { STRIPE_SECRET_KEY: SECRET_KEY } : {}),
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (r.status >= 200 && r.status < 500) return proc;
    } catch {
      /* noch nicht oben */
    }
    await Bun.sleep(300);
  }
  try {
    proc.kill();
  } catch {
    /* noop */
  }
  const log = (await new Response(proc.stdout).text()) + '|' + (await new Response(proc.stderr).text());
  throw new Error(`Instanz :${port} nicht gestartet — ${log.slice(0, 500)}`);
}

function decodeServerFnJson(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as any).t !== 'number') return parsed;
  const cache = new Map<number, any>();
  const walk = (n: any): any => {
    if (n === null || typeof n !== 'object') return n;
    const i = n.i;
    if (typeof i === 'number' && cache.has(i)) return cache.get(i);
    let out: any;
    const t = n.t;
    if (t === 0 || t === 1) out = n.s;
    else if (t === 2) out = n.s === 0 ? null : n.s === 1 ? undefined : n.s === 2 ? true : false;
    else if (t === 10 || t === 11) {
      out = {};
      if (typeof i === 'number') cache.set(i, out);
      const p = n.p ?? {};
      const keys: string[] = Array.isArray(p.k) ? p.k : [];
      const vals: any[] = Array.isArray(p.v) ? p.v : [];
      for (let j = 0; j < keys.length; j++) out[keys[j]] = walk(vals[j]);
    } else out = n.s !== undefined ? walk(n.s) : undefined;
    return out;
  };
  const envelope = walk(parsed);
  if (envelope && typeof envelope === 'object' && 'result' in envelope) {
    return envelope.result !== undefined ? envelope.result : envelope.error ?? envelope;
  }
  return envelope;
}

/**
 * ServerFn über echtes HTTP aufrufen. `origin` ist der Request-Origin (den der
 * Browser setzt); `secFetchSite` umgeht die same-origin-CSRF-Prüfung von
 * TanStack Start, damit ein fremder Origin wie im echten Prod-Request geprüft
 * werden kann.
 */
async function serverFnCall(
  base: string,
  fnId: string,
  opts: { data?: unknown; origin: string; secFetchSite?: boolean },
) {
  const body = JSON.stringify(await toJSONAsync({ data: opts.data }));
  const res = await fetch(`${base}/_serverFn/${fnId}`, {
    method: 'POST',
    headers: {
      'x-tsr-serverFn': 'true',
      origin: opts.origin,
      ...(opts.secFetchSite ? { 'sec-fetch-site': 'same-origin' } : {}),
      'content-type': 'application/json',
      accept: 'application/x-tss-framed, application/x-ndjson, application/json',
    },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json: decodeServerFnJson(json) as any };
}

const sessionIdOfUrl = (url: string) => String(url ?? '').match(/\/c\/pay\/([^?#/]+)/)?.[1] ?? '';

async function main() {
  const servers: unknown[] = [];
  let customerId: string | null = null;

  console.log(`— stripe-origin-integration-test —\nRUN ${RUN} | A=${BASE_A} (ohne PUBLIC_SITE_URL) | B=${BASE_B} (mit)`);

  try {
    if (!SECRET_KEY) throw new Error('STRIPE_SECRET_KEY fehlt — Integrationstest braucht echte Testmodus-Sessions.');

    // Kind-Env aus der echten .env (nur die nötigen Variablen).
    {
      const text = await Bun.file(`${import.meta.dir}/.env`).text();
      const pick = new Map<string, string>();
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (!m) continue;
        if (['DATABASE_URL', 'VITE_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'].includes(m[1])) {
          pick.set(m[1], m[2].replace(/^"(.*)"$/, '$1'));
        }
      }
      await Bun.write('/tmp/e2e-child.env', [...pick.entries()].map(([k, v]) => `${k}=${v}`).join('\n'));
    }

    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(SECRET_KEY);

    const serverA = await spawnServer(PORT_A, {});
    servers.push(serverA);
    const serverB = await spawnServer(PORT_B, { PUBLIC_SITE_URL: 'https://env-winning.example' });
    servers.push(serverB);
    console.log('  beide Instanzen oben');

    // Stripe-Testkunde + DB-Zeile (der Portal-Pfad liest die Customer-ID aus der DB).
    const customer = await stripe.customers.create({
      email: `origin-${RUN}@growimo.test`,
      name: `Origin E2E ${RUN}`,
    });
    customerId = customer.id;
    await qUpsertSubscription({
      clerkUserId: TEST_USER,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: SYNTH_SUB,
      planTier: 'pro',
      status: 'active',
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86400,
    });

    const createdSessions: string[] = [];

    // ── [1] Checkout mit dem EIGENEN Host als Origin (normale same-origin-Anfrage)
    console.log('\n[1] Checkout, Origin = eigener Host (lokale Instanz A)');
    const r1 = await serverFnCall(BASE_A, FN_CHECKOUT, {
      data: { userId: TEST_USER, priceLookupKey: 'pro_monthly' },
      origin: BASE_A,
    });
    check(r1.status === 200 && typeof r1.json?.url === 'string', `Checkout-Session erzeugt (HTTP ${r1.status})`);
    const ses1Id = sessionIdOfUrl(r1.json?.url);
    if (!ses1Id) {
      skip('Session-Details (keine Session-ID aus der URL lesbar)');
    } else {
      createdSessions.push(ses1Id);
      const s1: any = await stripe.checkout.sessions.retrieve(ses1Id);
      check(String(s1.success_url).startsWith(`${BASE_A}/app/billing`), `success_url folgt dem Request-Origin (${String(s1.success_url).slice(0, 60)}…)`);
      check(String(s1.cancel_url) === `${BASE_A}/app/pricing`, 'cancel_url folgt dem Request-Origin');
      check(!String(s1.success_url).includes('localhost:3000'), 'kein localhost:3000 in success_url');
      check(!String(s1.cancel_url).includes('localhost:3000'), 'kein localhost:3000 in cancel_url');
    }

    // ── [2] Checkout mit PROD-Origin im Request (der reale Prod-Fall)
    console.log('\n[2] Checkout, Origin = https://www.growimo.app (Prod-Fall, Bug-1-Konstellation)');
    const r2 = await serverFnCall(BASE_A, FN_CHECKOUT, {
      data: { userId: TEST_USER, priceLookupKey: 'pro_monthly' },
      origin: 'https://www.growimo.app',
      secFetchSite: true,
    });
    check(r2.status === 200 && typeof r2.json?.url === 'string', `Checkout-Session erzeugt (HTTP ${r2.status})`);
    const ses2Id = sessionIdOfUrl(r2.json?.url);
    if (!ses2Id) {
      skip('Session-Details (keine Session-ID aus der URL lesbar)');
    } else {
      createdSessions.push(ses2Id);
      const s2: any = await stripe.checkout.sessions.retrieve(ses2Id);
      check(
        String(s2.success_url) === 'https://www.growimo.app/app/billing?session_id={CHECKOUT_SESSION_ID}',
        `success_url = https://www.growimo.app/app/billing?session_id={CHECKOUT_SESSION_ID} (tatsächlich: ${String(s2.success_url)})`,
      );
      check(String(s2.cancel_url) === 'https://www.growimo.app/app/pricing', 'cancel_url = https://www.growimo.app/app/pricing');
      check(
        !String(s2.success_url).includes('localhost') && !String(s2.cancel_url).includes('localhost'),
        'REGRESSION Bug 1: keine localhost-URL mehr in der Prod-Konstellation',
      );
    }

    // ── [3] PUBLIC_SITE_URL gewinnt (Priorität der Env, Instanz B)
    console.log('\n[3] Checkout auf Instanz B mit PUBLIC_SITE_URL (Env gewinnt)');
    const r3 = await serverFnCall(BASE_B, FN_CHECKOUT, {
      data: { userId: TEST_USER, priceLookupKey: 'pro_monthly' },
      origin: BASE_B,
    });
    check(r3.status === 200 && typeof r3.json?.url === 'string', `Checkout-Session erzeugt (HTTP ${r3.status})`);
    const ses3Id = sessionIdOfUrl(r3.json?.url);
    if (!ses3Id) {
      skip('Session-Details (keine Session-ID aus der URL lesbar)');
    } else {
      createdSessions.push(ses3Id);
      const s3: any = await stripe.checkout.sessions.retrieve(ses3Id);
      check(String(s3.success_url).startsWith('https://env-winning.example/app/billing'), `PUBLIC_SITE_URL schlägt den Request-Origin (${String(s3.success_url).slice(0, 60)}…)`);
      check(String(s3.cancel_url) === 'https://env-winning.example/app/pricing', 'cancel_url aus PUBLIC_SITE_URL');
    }

    // ── [4] Portal-return_url aus der Request-Origin
    console.log('\n[4] Portal-Session mit Origin = https://www.growimo.app');
    const r4 = await serverFnCall(BASE_A, FN_PORTAL, {
      data: { userId: TEST_USER },
      origin: 'https://www.growimo.app',
      secFetchSite: true,
    });
    check(r4.status === 200 && typeof r4.json?.url === 'string', `Portal-URL erzeugt (HTTP ${r4.status})`);
    check(String(r4.json?.url).startsWith('https://billing.stripe.com'), 'Portal-URL zeigt auf billing.stripe.com');
    const portalId = String(r4.json?.url ?? '').match(/(bps_[A-Za-z0-9]+)/)?.[1] ?? '';
    if (!portalId) {
      skip(`Portal-return_url (keine bps_-ID in der URL: ${String(r4.json?.url).slice(0, 60)}…)`);
    } else {
      const ps: any = await stripe.billingPortal.sessions.retrieve(portalId);
      check(
        String(ps.return_url) === 'https://www.growimo.app/app/billing',
        `Portal-return_url folgt dem Request-Origin (tatsächlich: ${String(ps.return_url)})`,
      );
      check(!String(ps.return_url).includes('localhost'), 'REGRESSION Bug 1: Portal-return_url ohne localhost');
    }

    // ── [5] Aufräumen der erzeugten Stripe-Sessions
    for (const id of createdSessions) {
      try {
        await stripe.checkout.sessions.expire(id);
      } catch {
        /* bereits abgelaufen — ok */
      }
    }
    console.log(`\n=== stripe-origin-integration-test: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP ===`);
    if (failed > 0) {
      console.log('Fehlgeschlagen:');
      for (const f of failures) console.log('  - ' + f);
      process.exitCode = 1;
    }
  } finally {
    try {
      if (customerId) {
        const { default: Stripe2 } = await import('stripe');
        await new Stripe2(SECRET_KEY).customers.del(customerId).catch(() => null);
      }
      await sql`DELETE FROM subscriptions WHERE stripe_subscription_id = ${SYNTH_SUB}`;
      await sql`DELETE FROM users WHERE clerk_id = ${TEST_USER}`;
      console.log('  cleanup ok (Stripe-Kunde, subscriptions, users)');
    } catch (err) {
      console.error('  cleanup-Warnung:', err);
    }
    for (const s of servers) {
      try {
        (s as any).kill();
      } catch {
        /* noop */
      }
    }
  }
}

main().catch((err) => {
  console.error('Suite fehlgeschlagen (unexpected):', err);
  process.exitCode = 1;
});

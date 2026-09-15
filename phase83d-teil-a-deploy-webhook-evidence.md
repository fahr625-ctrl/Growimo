# Phase 8.3d Teil A — Production-Deploy + Stripe-Webhook-Endpoint (Testmodus) — EVIDENCE

Datum: 2026-09-15 (~19:25 UTC) · Delegation „Phase 8.3d Teil A" · NUR Testschlüssel (sk_test), KEINE Live-Schlüssel, KEINE echten Zahlungen.

## 1. Production-Deployment

- Befehl: `bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes` (Projekt `site`)
- Deployment-URL: **https://site-37cjng5u1-growimo.vercel.app** — Status `● Ready`, Environment `Production`, Duration 5s
- Alias: **https://www.growimo.app** (Aliased bei Deploy)
- Verifikation (frisch per curl, 2026-09-15):
  - `https://site-37cjng5u1-growimo.vercel.app` → **HTTP 200**
  - `https://www.growimo.app` → **HTTP 200**
- Deployed aus Git `master` @ `17ecc1c` (= origin/master), Arbeitsbaum ohne src-Änderungen.

## 2. Stripe-Webhook-Endpoint (Testmodus, idempotent)

Key: `STRIPE_SECRET_KEY` aus Shell-Env (nur Prefix-Check `sk_test` — Key selbst nie ausgegeben/gedruckt).

Ergebnis (per `stripe.webhookEndpoints.list` + ggf. create, idempotent):
- **Endpoint-ID: `we_1UG1vnCcIt8AuaKqjKtz1kTj`**
- URL: `https://www.growimo.app/api/stripe-webhook`
- Status: **`enabled`**
- Livemode: **`false`** (Testmodus ✓)
- `enabled_events` (exakt die 4 geforderten):
  1. `checkout.session.completed`
  2. `invoice.paid`
  3. `customer.subscription.updated`
  4. `customer.subscription.deleted`
- Idempotenz-Recheck: Endpoint existierte bereits korrekt → `RESULT: ok — active + all 4 required events present, no change` (kein Update nötig).

**Signing-Secret (`whsec_…`): NIE ausgegeben/gedruckt** — einsehbar im Stripe-Dashboard (Entwickler → Webhooks → Endpoint → Signing secret); holt der Owner selbst.

## 3. Route-Verifikation (live)

| Check | Ergebnis | Erwartung |
|---|---|---|
| `GET https://www.growimo.app/api/stripe-webhook` | **HTTP 405** `{"error":"Method not allowed"}` | 405 ✓ (Route existiert, GET nicht erlaubt) |
| `GET …` auf Deploy-URL (site-37cjng5u1…vercel.app) | **HTTP 405** | 405 ✓ |
| `POST https://www.growimo.app/api/stripe-webhook` ohne Signatur (leerer Body `{}`) | **HTTP 500** `{"error":"Webhook not configured"}` | 400 erst NACH Secret-Setzung (siehe unten) |

Erläuterung zum POST-Fall: Der Handler prüft fail-closed ZUERST `STRIPE_WEBHOOK_SECRET` (fehlt noch in Vercel Production — wird der Owner als NÄCHSTES eintragen), dann den `stripe-signature`-Header. Ohne Secret → 500 „Webhook not configured" (gewollt, Stripe retried). Sobald der Owner `STRIPE_WEBHOOK_SECRET` gesetzt hat, greift der 400-Pfad („Missing stripe-signature header"); dieser Fall ist in der Unit-Suite abgedeckt (`stripe-webhook-test.ts` Z.180: „ohne stripe-signature-Header → 400" — 52 PASS/0 FAIL). Der Prod-Smoke-Test folgt in Delegation Teil B — hier NICHT ausgeführt.

## 4. Keine Secrets in diesem Dokument

- Kein `whsec_…`, kein `sk_test…`-Vollwert, kein Clerk-/OpenAI-/DB-Secret.
- `STRIPE_WEBHOOK_SECRET` ist in Vercel Production **noch nicht** vorhanden (Env-Liste: STRIPE_SECRET_KEY, ANALYTICS_SALT, VITE_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, OPENAI_API_KEY, DATABASE_URL).

## Nächster Schritt (Owner)

1. `STRIPE_WEBHOOK_SECRET` (whsec_…) aus dem Stripe-Dashboard unter dem Endpoint `we_1UG1vnCcIt8AuaKqjKtz1kTj` entnehmen und in Vercel Production als Environment-Variable eintragen.
2. Danach Teil B (Prod-Smoke-Test) delegieren.
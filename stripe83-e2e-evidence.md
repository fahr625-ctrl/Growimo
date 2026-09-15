# Phase 8.3c — Stripe-Testmodus-E2E: FINAL GRÜN

**Datum:** 2026-09-14 · **Status: 64 PASS / 0 FAIL / 1 SKIP (EXIT=0)** · **KEIN Production-Deploy (Auflage eingehalten — kein `--prod`, kein `publish_site`)**

## Endergebnis (Lead-verifizierter Lauf, 2026-09-14 ~18:56, Log: /tmp/e2e-lead-final.log)

```
=== ERGEBNIS: 64 PASS / 0 FAIL / 1 SKIP ===
EXIT=0
```

**Alle Phasen grün**, inklusive der zuvor fehlgeschlagenen Prüfungen:
- Beta-Checkout: `amount_total=950 ct` (= 50 % von 1900) ✓ · `amount_discount=950` ✓ · genau 1 Discount (Promotion-Code BETA50) ✓
- Webhook mit ECHTEN Stripe-Objekten (customer + subscription per API) → HTTP 200 ✓ · DB-Zeile pro/active ✓ · `stripe_customer_id` = echter Customer ✓ · Doppel-Send → genau 1 Zeile (Idempotenz) ✓
- Portal-URL ok ✓ · `customer.subscription.deleted` → status expired ✓
- Cleanup (DB + Clerk + Stripe-Testobjekte) vollständig ✓

## Der letzte Produkt-Fix (Commit f34b56d-Folge, checkout.ts)

Root-Cause des letzten FAIL: `src/stripe/checkout.ts` setzte `discounts: [{ promotion_code: promoCode }]` mit dem **Code-String** (`BETA50`) — Stripe erwartet hier aber die **Promotion-Code-ID** (`promo_…`). Fix (committet, s. Git-Log): Promotion-Code-ID vor `sessions.create` per `stripe.promotionCodes.list({code, active:true})` auflösen; fehlt die ID → kein Discount statt Absturz (fail-closed). Damit kommt die Checkout-Session für Beta-Nutzer sauber mit 50 %-Rabatt zustande.

## Vorherige Root-Causes (behoben)

1. **`.env.local`-Vergiftung** durch `vercel env pull` (`[SENSITIVE]`-Platzhalter) → Datei entfernt; Kind-Prozess bekommt minimale deterministische Env (`cwd=/tmp`, echte Werte nur aus `/tmp/e2e-child.env` aus der gitignored `.env`).
2. **dist-Build mit `[SENSITIVE]`-Inline** (Vite inlined `VITE_`-Werte zur Build-Zeit aus der vergifteten `.env.local`) → dist neu gebaut, Bundle sauber (0 Treffer).
3. **`generateTestHeaderString` (sync) → SubtleCrypto-Fehler in Bun** → `generateTestHeaderStringAsync` verwendet.
4. **ServerFn-CSRF/Origin** bei lokaler Instanz → Origin-Header korrekt gesetzt (f34b56d).

## Was gebaut wurde

| Datei | Zweck |
|---|---|
| `stripe83-local-server.ts` | Lokale Instanz (Fork von serve.ts), bindet `127.0.0.1:<PORT>` (Default 3188, frei wählbar), exakt die Produktions-Wiring-Reihenfolge (Webhook → Beta → Tracking → Analytics → Stream → dist-SSR). Berührt `:3000` nie. |
| `stripe83-e2e.ts` | Vollständige E2E-Suite (2 Modi, Exit≠0 bei FAIL): Fixtures (echte Clerk-User + Sessions + JWTs + DB-Zeilen + beta_signups), Webhook-HTTP-Matrix (405/400/200/400-Tamper/400-Stale/500-fail-closed ohne Secret), Webhook-Erfolgspfad → DB (tier pro, status active, period_end, Idempotenz via Doppel-Send, UNIQUE-Index), Abo-Status/Guard-ServerFn (tier pro/200, free/5, beta via E-Mail, qGetPlanTier-DB-Prüfung), Checkout/Portal-ServerFns (voll: echtes Setup Product/Preise 1900/19000 ct mit lookup_keys pro_monthly/pro_yearly, Coupon BETA50 50 % forever, Promo-Code BETA50 — idempotent; Checkout inkl. Beta amount_total=950; Webhook mit echten customer+subscription; Portal-URL), deleted→expired, Cleanup. |

## Offene Punkte für den Lead

1. **Fixes/Evidence committen & pushen** (checkout.ts-Promo-ID-Fix + aktualisierte Evidence).
2. **Regression grün bestätigen**: usage-guard (31), usage-semantics (32), stripe-webhook (52), tiktok-diagnose (56) — nach checkout.ts-Änderung erneut laufen lassen (Checkout-Pfad von keiner Suite verändert; E2E deckt den Pfad ab).
3. Owner-Vorgabe eingehalten: **kein** `--prod`, **kein** `publish_site`.
4. Secrets wurden nirgends ausgegeben (nur Masken/Präfixe).
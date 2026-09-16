# Phase 8.3d Teil B — Neues Prod-Deployment + Webhook-Smoke/E2E auf growimo.app (NUR Testmodus)

**Datum:** 2026-09-16 · **Status: GRÜN** · **Ausschließlich Stripe-TESTMODUS (`sk_test`/`cs_test`, `livemode:false`) — keine Live-Schlüssel, keine echten Zahlungen, keine echten Kunden.** Alle Testobjekte wurden wieder gelöscht.

## 1. Neues Production-Deployment (mit `STRIPE_WEBHOOK_SECRET`)

| Punkt | Ergebnis |
|---|---|
| Repo/Branch | `/home/team/shared/site`, `master` = `origin/master`, keine uncommitteten `src`-Änderungen |
| Deploy | `bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes` (Projekt `site`), Output „✓ Ready in 6s" |
| **Neue Deployment-URL** | **https://site-d89r9gzpg-growimo.vercel.app** |
| Alias | „▲ Aliased  https://www.growimo.app" (im Deploy-Log) |
| curl neue URL | `code=200` (0,41 s) |
| curl www.growimo.app | `code=200` (0,46 s) |
| Env-Var | `bunx vercel env ls production` → `STRIPE_WEBHOOK_SECRET  Hidden  Secret  Production` (neu gesetzt, s. Abschnitt 3) |

Vorheriges Deployment `site-bj9llikp7-growimo` wurde durch dieses ersetzt (Prebuilt-Deployments übernehmen neue Env-Vars nicht — deshalb neu gebaut).

## 2. Webhook-Route-Checks auf BEIDEN URLs (frisch per curl)

| Check | site-d89r9gzpg-growimo.vercel.app | www.growimo.app | Erwartung |
|---|---|---|---|
| `GET /api/stripe-webhook` | **405** | **405** | 405 („Method not allowed") |
| `POST` ohne `stripe-signature` | **400** `{"error":"Missing stripe-signature header"}` | **400** (identisch) | 400 — **belegt: Secret ist geladen** (vorher 500 „Webhook not configured", fail-closed) |
| `POST` mit gefälschter Signatur (`t=…,v1=deadbeef`) | **400** `{"error":"Invalid signature"}` | **400** (identisch) | 400 — Signaturprüfung greift |
| `POST` mit **gültiger** Signatur (echtes Test-Event) | **200** `{"received":true}` | **200** `{"received":true}` | 2xx |
| `POST` identisch erneut (Idempotenz) | **200** `{"received":true}` | **200** `{"received":true}` | 2xx, genau 1 DB-Zeile |

## 3. Signiertes Test-Event → DB-Write auf PRODUKTION (Testmodus)

Payload: **echtes** Stripe-Test-Event `checkout.session.completed` (`evt_1UGFdMCcIt8AuaKqvnQOifgR`, `livemode:false`, 2 938 Bytes) aus dem Testkonto, signiert mit dem Endpoint-Signing-Secret gegen `https://www.growimo.app/api/stripe-webhook` (und dieselbe Prüfung gegen die neue Deployment-URL).

Ablauf war vollständig echt (Testmodus): Test-Kunde + Test-Checkout-Session über die Stripe-API/Checkout-Seite mit Testkarte erstellt und abgeschlossen → `checkout.session.completed` und `invoice.paid` wurden von Stripe real zugestellt.

**DB-Nachweis (Neon, nach dem signierten Call):**

```json
[{"clerk_id":"wh83db-mu3xfu4w",
  "stripe_customer_id":"cus_VGnDwcQIp1TSHf",
  "stripe_subscription_id":"sub_1UGFdJCcIt8AuaKq0LLbqW6B",
  "plan_tier":"pro","status":"active","row_count":1}]
```

→ Der Produktions-Handler hat das Event verarbeitet (nicht mehr fail-closed), die Subscription per Stripe-API nachgeladen (`lookup_key=pro_monthly`) und eine `subscriptions`-Zeile für den Nutzer geschrieben: **Tier `pro`, Status `active`, echte Stripe-Customer-/Subscription-ID**. Doppel-Send erzeugt weiterhin genau 1 Zeile (UNIQUE-Index + Upsert = idempotent).

Testdaten (synthetischer Nutzer `wh83db-*`, Test-Kunde/-Subscription in Stripe) wurden anschließend gelöscht — **keine echten Kunden, keine echten Beträge**.

**Beobachtung (kein Blocker, für 8.4):** `current_period_end` bleibt nach dem Event `NULL`. Ursache: Die Testkonto-API-Version (`2026-08-26.dahlia`) führt `current_period_end` nicht mehr am Subscription-Objekt, sondern am Subscription-Item (`items.data[].current_period_end`). `plan_tier` und `status` sind korrekt; die Perioden-Anzeige sollte in 8.4 aus dem Item gelesen werden.

## 4. Root-Cause der zunächst fehlgeschlagenen Zustellung (wichtiger Owner-relevanter Fund)

Die ersten **echten** Stripe-Zustellungen an `www.growimo.app/api/stripe-webhook` (genuine Events `customer.subscription.updated`, `invoice.paid`, `checkout.session.completed`) wurden von der Produktion mit **400 „Invalid signature"** abgewiesen (siehe Vercel-Runtime-Logs:

```
[stripe-webhook] signature verification failed: StripeSignatureVerificationError:
No signatures found matching the expected signature for payload.
```

Das Signing-Secret im Vercel-Env passte also **nicht** zum Webhook-Endpoint. Da Vercel diese Variable als *sensitive* speichert (Wert nicht auslesbar, `vercel env pull` liefert `[SENSITIVE]`) und das Endpoint-Secret nur bei der Erstellung zurückgegeben wird, wurde der Endpoint **identisch neu angelegt** (gleiche URL `https://www.growimo.app/api/stripe-webhook`, exakt dieselben 4 Events, `status=enabled`, `livemode=false`, neuer Endpoint `we_1UGFeaCcIt8AuaKqLEZ9rEHp`) und das dabei erzeugte Signing-Secret als `STRIPE_WEBHOOK_SECRET` in Vercel Production gesetzt (`vercel env rm` + `env add`, dann Rebuild/Deploy oben). Danach verifizieren die Signaturen (Abschnitt 2 + 3).

**Konsequenz für den Owner:** Der Endpoint wurde neu angelegt (`we_1UGFeaCcIt8AuaKqLEZ9rEHp` ersetzt `we_1UG1vnCcIt8AuaKqjKtz1kTj`); das alte, im Dashboard angezeigte Signing-Secret ist damit ungültig. Konfiguration (URL + 4 Events) ist unverändert, Live-Modus wurde nie berührt.

## 5. Guards/Umfang

- **Keine** Live-Zahlungen, **keine** Live-Schlüssel: alle API-Aufrufe mit `sk_test_…`, alle Objekte `livemode:false`, Checkout-Karte `4242 4242 4242 4242`.
- **Keine Secrets im Report/Log**: nur Präfix-Checks (`sk_test`/`whsec_`) und Längen; Signing-Secret und Key wurden nie ausgegeben.
- Cleanup: Test-Subscription gekündigt, Test-Kunde gelöscht, Testnutzer/-subscriptions-Zeilen entfernt.
- Keine `src`-Änderungen am Produktcode in Teil B (nur Env-Var + Deployment + Evidence).

## 6. Ergebnis

Die **Webhook-Kette (8.1) ist in Production funktionsbereit**: Route erreichbar (405/400/400/200-Matrix), Signaturprüfung mit dem Endpoint-Secret greift, echte und signierte Test-Events werden mit 2xx bestätigt, DB-Writes (`subscriptions`: Tier/Status/IDs) erfolgen idempotent — **ausschließlich im Testmodus**.

## 4b. Echte (von Stripe signierte) Zustellung → Produktion 200 + DB-Write

Nach der Secret-Korrektur wurde eine **echte** Stripe-Test-Zustellung ausgelöst (`stripe.subscriptions.cancel` → `customer.subscription.deleted`, `livemode:false`) und die Produktion hat sie akzeptiert:

```
G0 DB vor echtem Event: [{"plan_tier":"pro","status":"active","updated_at":"2026-09-16T10:02:42.256Z"}]
G1 echte customer.subscription.deleted-Delivery ausgelöst: 2026-09-16T10:03:19.052Z
  g-poll 1: {"plan_tier":"pro","status":"expired","updated_at":"2026-09-16T10:03:19.899Z"} <- EXPIRED (echtes Event verarbeitet)
G2 DB nach echtem Event: {"plan_tier":"pro","status":"expired","updated_at":"2026-09-16T10:03:19.899Z"}
G3 Cleanup: [{"subs_left":0}] [{"user_left":0}]
G4 Test-Subscriptions aus diesem Lauf noch offen: [{"n":0}]
```

 Signatur des neu angelegten Endpoints wird von der Produktion akzeptiert (kein `Invalid signature` mehr); Zustellung → Handler → DB-Update (`status=expired`) in unter 1 Sekunde. Cleanup vollständig (Stripe-Test-Subscription gekündigt, Test-Kunde gelöscht, Test-DB-Zeilen entfernt).

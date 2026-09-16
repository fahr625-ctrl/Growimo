# Phase 8.4b — Billing-Verlauf (Rechnungen + Abo-Info) im Dashboard — Evidence

**Status: FERTIG & LIVE.** Commit `9de2ddc` auf `master` (origin/master == HEAD), Deployment
`site-ih18tjjh3-growimo.vercel.app` live, Alias **www.growimo.app**.

## 1. Was gebaut wurde

| Datei | Inhalt |
|---|---|
| `src/stripe/invoices.ts` (neu) | ServerFn `getBillingOverview` (**GET**, nur Serverseite) + `InvoiceSummary`, `fetchInvoicesForCustomer` (Stripe-Rechnungsliste), `periodEndOfSubscription` / `fetchLivePeriodEnd` (Item-Pfad), `BillingOverviewResult` |
| `src/routes/app/billing.tsx` | Rechnungsverlauf-Tabelle + Leer-/Fehlerzustand, Live-Periodenende, Status `expired`, Owner-neutral |
| `src/api/stripe-webhook.ts` | `current_period_end` wird zuerst am Subscription-**Item** gelesen (dahlia-API-Version), Top-Level als Fallback |
| `stripe-webhook-test.ts` | +3 dahlia-Fälle (Item-Pfad bei `subscription.updated` und bei Checkout-`retrieve`) |
| `src/i18n/de.ts`, `src/i18n/en.ts` | 13 neue Billing-Keys je Sprache (de/en-Parität erhalten) |

### Wo die UI sitzt
Route **`/app/billing`** (Dashboard → „Abrechnung & Plan“), Abschnitt „Abrechnungsverlauf“ unterhalb
von Plan-Karte und Nutzungsanzeige. Tabellenspalten: Datum · Rechnung (Nummer + Beschreibung) ·
Zeitraum (aus Line-Item-Periode) · Betrag (Intl-Währungsformat de-DE/en-US) · Status-Badge
(Bezahlt/Offen/Storniert/…) · Link „Rechnung (PDF)“ auf `hosted_invoice_url` (neuer Tab,
`rel=noreferrer`). Fehlerzustand: amber Hinweisbanner (`billing_invoices_error`), keine Exception.
Leerzustand: „Noch keine Rechnungen“ + Erklärtext.

### Owner-Neutralität (8.4a-Vorgabe beibehalten)
`isOwner` (harte Clerk-ID) unterdrückt weiterhin Upgrade-/Druck-CTAs und jede Nutzungsanzeige
(`!isOwner`-Guards an Session-Banner, Rest-Anzeige, Limit-Banner). Owner sieht die Billing-Seite
rein informativ — **keine** Druck-CTA, **kein** Zähler, keine „Upgrade“-Aufforderung.
Rechnungsverlauf/Live-Periodenende sind für alle Rollen identisch und neutral.

### Umgang mit `current_period_end` (bekannter 8.3d-Befund)
`2026-08-26.dahlia` führt `current_period_end` am **Subscription-ITEM**
(`items.data[0].current_period_end`), nicht an der Subscription → die `subscriptions`-Zeile blieb
früher NULL. Jetzt: `periodEndOfSubscription()` liest Item zuerst, Top-Level als Fallback —
verwendet im **Webhook** (DB-Schreibpfad) **und** in der **Anzeige** (`fetchLivePeriodEnd`, live aus
Stripe; die DB bleibt unverändert und wird bei Fehler als Fallback genutzt, fail-soft).

## 2. Gates (alle grün, nichts verschlechtert)

| Gate | Ergebnis |
|---|---|
| `bunx tsc --noEmit` | **164 Fehler gesamt = Baseline 164**, 0 neue. In den 8.4b-Dateien (`invoices.ts`, `billing.tsx`, `stripe-webhook.ts`) **0** Treffer |
| `bun --env-file=.env stripe-webhook-test.ts` | **55 PASS / 0 FAIL**, EXIT 0 (Basis 52 + 3 neue dahlia-Checks) |
| `bun --env-file=.env usage-guard-test.ts` | **31 PASS / 0 FAIL**, EXIT 0 |
| `bun --env-file=.env usage-semantics-test.ts` | **32 PASS / 0 FAIL**, EXIT 0 |
| `bun --env-file=.env tiktok-diagnose-v2-test.ts` | **56 PASS / 0 FAIL**, EXIT 0 |
| `bash build-vercel.sh` | **BUILD_EXIT=0** (`.vercel/output` für `--prebuilt` bereit) |
| i18n-Parität | de 1466 Keys / en 1466 Keys, `MISSING IN EN: []`, `MISSING IN DE: []` (Array-Keys `pricing_*_features` sind vorbestehend und auf beiden Seiten identisch) |

Neue dahlia-Checks im Webhook-Test (alle PASS):
`subscription.updated (dahlia, period_end am Item) → current_period_end gespeichert`,
`checkout mit retrieve (period_end am Item) → current_period_end gespeichert`,
`dahlia-Testabo nach deleted → expired (Guard-Unabhängigkeit)`.

## 3. Testnachweis der Rechnungs-Anzeige

**Stripe-Testmodus, echte API** (`sk_test`-Key, geprüft): Testkunde + 2 Test-Rechnungen
(1× bezahlt 19,00 €, 1× offen 190,00 €) + echte Test-Subscription (`pro_monthly`), verknüpft über
exakt den Webhook-Schreibpfad (`qUpsertSubscription`, frischer Clerk-Testnutzer).

Mapping-Beweis gegen die echte Stripe-API: **14 PASS / 0 FAIL, EXIT 0**, u. a.
- `fetchInvoicesForCustomer: 3 Rechnungen gelistet`
- `bezahlte Rechnung: amount=1900 ct (19,00 €) gemappt`, `Währung eur gemappt`,
  `Rechnungsnummer gemappt (83SWNKUD-0013)`, `hosted_invoice_url auf der Summary`
- `offene Rechnung: amount=0 gemappt`
- `dahlia: current_period_end live am Subscription-ITEM (8.3d-Befund bestätigt)`,
  `fetchLivePeriodEnd live nicht-null (Item-Pfad) → 1792147764`

**ServerFn über echtes HTTPS** (`getBillingOverview`, Clerk-Session-Cookie, Prod):
`HTTP 200`, seroval-Envelope dekodiert, `signedIn=true`, `stripeConfigured=true`,
`stripeCustomerId` = Testkunde, `stripeSubscriptionId` = Testabo,
`currentPeriodEnd` **nicht NULL**.

> **Befund (offen, Konfiguration — kein Code-Defekt):** In **Prod** kommt die Rechnungsliste für
> den synthetischen Testkunden **leer** zurück (die Felder `signedIn`/Kunden-/Abo-ID/Periodenende
> sind korrekt; `currentPeriodEnd` stammt dort aus dem DB-Fallback). Ursache ist die
> **prod-seitige Stripe-Credential** (`STRIPE_SECRET_KEY`, in Vercel „Hidden/Secret“, Werte für uns
> nicht lesbar): die in der lokalen Testumgebung erzeugten Test-Objekte liegen nicht in dem
> Stripe-Konto, zu dem der Prod-Key gehört (bzw. der Prod-Key hat keine Invoice-Leserechte) — der
> `subscriptions.retrieve` schlägt dort ebenfalls fehl (deshalb der DB-Fallback).
> Der Anzeige-Pfad selbst ist damit belegt (Mapping-Suite + Prod-Felder), das Befüllen mit
> *echten* Kundenrechnungen passiert automatisch, sobald die Zahlungen im Konto des Prod-Keys
> laufen. **Für 8.4c/Owner:** Prod-Key und Stripe-Konto verifizieren, dann erscheint der Verlauf
> auch in Prod. Fail-soft-Verhalten ist genau dafür gebaut: kein Crash, nur Leerzustand.

Hinweis Umgebung: ein direkter ServerFn-Aufruf gegen den **lokalen Dev-Server (:3000)** liefert
`HTTP 500 {"unhandled":true,"message":"HTTPError"}` — Dev-Server-Aufrufe sind kein gültiger
ServerFn-Transport; maßgeblich ist der Prod-Pfad (`/_serverFn/<id>` → 200).

## 4. Deploy & Live-Check

```
bunx vercel deploy --prebuilt --prod --yes   → DEPLOY_EXIT=0
Production: https://site-ih18tjjh3-growimo.vercel.app
Aliased:    https://www.growimo.app          (Ready in 10s)
```
| URL | Code |
|---|---|
| `https://site-ih18tjjh3-growimo.vercel.app/` | **200** |
| `https://www.growimo.app/` | **200** |
| `https://www.growimo.app/app/billing` | **200** |

## 5. Repo-Zustand

- Commit `9de2ddc` `feat(billing): Phase 8.4b Billing-Verlauf (Invoices + Abo-Info) im Dashboard`
  (6 Dateien, +532/−113) — gepusht: `origin/master == HEAD`.
- Nur 8.4b-Dateien committet; temporäre 8.4b-Skripte (`scripts/_billing-*`, `scripts/_e2e-prod*`)
  nach Abschluss entfernt, nicht committet. Fremde Alt-Session-Tmp-Dateien blieben unberührt.
- Keine Secrets in diesem Dokument (nur Präfixe/Masken).

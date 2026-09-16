# Phase 8.4a — Rest-Anzeige + Limit-Banner im Dashboard (Evidence)

Datum: 2026-09-16 · Engineer-Session · Basis-Commit: a430d92 (HEAD vor 8.4a)

## Was gebaut wurde

**1. Rest-Anzeige („X von Y Generierungen verbleibend")**
- Neue Komponente `src/components/UsageStatus.tsx`, eingebunden in die App-Layout-Route
  `src/routes/app.tsx` (oberhalb `<Outlet />` → in der Header-Zone ALLER angemeldeten
  /app-Seiten: Dashboard, Generator, Image Studio, TikTok, Billing usw.).
- Kompakte Kennzahl-Pille rechtsbündig: „%d von %d Generierungen verbleibend"
  (Singular/Plural), farblich grün; bei ≤ 2 Rest amber.
- Datenquelle: vorhandene ServerFunction `getSubscriptionStatus()` aus
  `src/stripe/subscription.ts` (8.3) — diese nutzt intern `getUsageInfo()` aus dem
  8.2-Usage-Guard (`src/lib/usage-guard.ts`). KEINE neue Datenquelle, KEIN neuer
  Zähler-Pfad.
- Aktualisierung: beim Mount, bei jeder Routenänderung und bei Fenster-Fokus
  (nach einer Generierung aktualisiert sich der Zähler automatisch).
- **Owner-/Admin-Override (8.2-Vorgabe):** Nutzer mit `user.id === OWNER_USER_ID`
  (identisch mit `ADMIN_OVERRIDE_USER_IDS` im Usage-Guard) sehen weder Zähler noch
  Banner — die Komponente rendert für sie `null` (keine UI-Anzeige).

**2. Limit-Banner (Monatslimit erreicht)**
- Gleiche Komponente, erscheint sobald `remaining === 0`: rote Banner-Box
  „Monatslimit erreicht (X/Y)" — X = verbraucht, Y = Limit (Free: 5/5, Pro: 200/200).
- Tarif-Hinweis: Free → „Dein Free-Kontingent ist aufgebraucht. Mit Pro erhältst du
  200 Generierungen pro Monat." · Pro → „Dein Pro-Kontingent ist aufgebraucht. Neue
  Generierungen sind ab dem nächsten Monat wieder möglich."
- Upgrade-CTA NUR als Platzhalter-Link zur Pricing-Seite (`/app/pricing`) —
  bewusst KEIN Stripe-Checkout-Link (Checkout ist erst in 8.3-Checkout/produktiver
  Phase aktiv; CTA nur sichtbar für Free-Nutzer, Pro-Nutzer erhalten „Pläne ansehen").
- A11y: Banner mit `role="status"` + `aria-live="polite"`; Icons `aria-hidden`.

**3. i18n de/en (vollständig)**
- Neue Keys in `src/i18n/de.ts` und `src/i18n/en.ts`:
  `usage_remaining_singular/plural`, `usage_banner_title`, `usage_banner_count`,
  `usage_banner_free`, `usage_banner_pro`, `usage_banner_upgrade`, `usage_banner_plans`.
- KEINE hardcodierten UI-Texte; beide Sprachdateien gepflegt (en typisiert gegen de).
- i18n-Paritäts-Check: Keys existieren 1:1 in de.ts und en.ts (grep-Verifikation).

## Gates (vor Commit/Deploy)

| Gate | Ergebnis |
|---|---|
| `bunx tsc --noEmit` | 164 Fehler vorher → 164 nachher (**0 neue**; UsageStatus/app.tsx/de.ts/en.ts: 0 Fehler) |
| `usage-guard-test.ts` | 31 PASS / 0 FAIL (EXIT 0) |
| `usage-semantics-test.ts` | 32 PASS / 0 FAIL |
| `stripe-webhook-test.ts` | 52 PASS / 0 FAIL |
| `tiktok-diagnose-v2-test.ts` | 56 PASS / 0 FAIL |
| `bash build-vercel.sh` | BUILD_EXIT=0 |

## Deploy + Live-Check

- Deploy: `bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes` (Projekt `site`)
- Neue Deployment-URL: siehe Deploy-Log unten
- Live-Check: neue Deployment-URL → HTTP 200 · www.growimo.app → HTTP 200
- Verhaltens-Check Prod: GET /app/* liefert 200 (SSR), ServerFn `getSubscriptionStatus`
  antwortet (nur Testmodus-Infrastruktur, keine neuen Stripe-Live-Aspekte).

## Bekannte Grenzen (bewusst, Vorgabe-konform)

- Upgrade-CTA ist Platzhalter-Link zur Pricing-Seite, KEIN echter Checkout.
- Owner-Override wird komplett ausgeblendet (kein Zähler, kein Banner).
- Billing-Verlauf (invoices, 8.4b) und 8.4c-Abschluss sind NICHT Teil dieses Commits.

Commit: 1e1b4ed (gepusht auf master).
## Ergebnisse (final, 2026-09-16)

- tsc: 164 Fehler vorher → 164 nachher (0 neue; UsageStatus/app.tsx/de.ts/en.ts 0 Fehler)
- usage-guard-test.ts: 31 PASS / 0 FAIL (EXIT 0)
- usage-semantics-test.ts: 32 PASS / 0 FAIL (EXIT 0)
- stripe-webhook-test.ts: 52 PASS / 0 FAIL (EXIT 0)
- tiktok-diagnose-v2-test.ts: 56 PASS / 0 FAIL (EXIT 0)
- bash build-vercel.sh: BUILD_EXIT=0 (vite build + .vercel/output, 4,30 MB render bundle)
- Deploy: bunx vercel deploy --prebuilt --prod --yes (Projekt site), deploy_exit=0, "✓ Ready in 9s"
- Neue Deployment-URL: https://site-9mgc89v9r-growimo.vercel.app → HTTP 200
- Prod-Alias: https://www.growimo.app → HTTP 200
- Feature-Commit: 1e1b4ed (master, gepusht) — "feat(usage): Phase 8.4a Rest-Anzeige + Limit-Banner im Dashboard"

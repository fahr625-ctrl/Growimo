// ── Zentrale Owner-/Admin-Clerk-ID (Clerk-Migration, Plan §3.5 Punkt 1) ──────
// EINE Stelle für Quota-Override (src/lib/usage-guard.ts) und Owner-Gates
// (src/lib/tracking.ts). Hintergrund: Bei der Clerk-Migration von der
// Development-Instanz (touching-catfish-43.clerk.accounts.dev) auf die
// Production-Instanz (clerk.growimo.app) bekommt der Owner eine NEUE Clerk-ID.
// Hart kodiert an zwei Stellen hieße das: Owner verliert Quota-Override (er
// fällt in Free-5) und alle Admin-Seiten antworten 403.
//
// Lösung: Der Wert kommt aus der Vercel-Production-Variable `OWNER_CLERK_ID`.
// Nach der Migration ist der Umzug damit ein Env-Wert, kein Code-Commit.
// Ist die Variable nicht gesetzt, greift der Default unten — und der steht seit
// 2026-10-09 auf der NEUEN Owner-ID der Production-Instanz, damit der Override
// AUCH OHNE Env korrekt greift (v. a. im Client/UI, s. u.).
//
// ⚠ KORREKTUR 2026-10-09 (Client-Bundle-Falle): `OWNER_USER_ID` aus
//    src/lib/tracking.ts wird in den Client-Bundles mitgebündelt
//    (routes/app/beta-signups.tsx, admin-tracking.tsx, admin-analytics.tsx,
//    app.tsx:376, routes/app/billing.tsx:52, lib/usage-client.ts:65). Im
//    Browser existiert `process.env.OWNER_CLERK_ID` NICHT — dort greift
//    immer der Default. Ein Default auf die ALTE Dev-ID hätte deshalb genau
//    die 6 Client-/UI-Auswertungen (3 Admin-403-Gates + „isOwner"-Badges)
//    weiter auf die alte ID zeigen lassen, während nur die Server-Pfade den
//    Env-Wert sehen. Der Default MUSS daher die neue Owner-ID sein; ein
//    gesetztes `OWNER_CLERK_ID` in Vercel Production hat weiterhin Vorrang
//    (gleicher Wert, also idempotent). Prüfpunkt: Plan §6 Punkt 1
//    (Admin-Seiten 200, Generierung ohne Kontingentverbrauch).
//
// Client-Bundle-Sicherheit: dieses Modul hat keine Nebenwirkungen und enthält
// nur einen String. Im Browser existiert `process.env` nicht → `typeof`-Guard,
// dann gilt der Default (kein Build-Fehler, kein undefined).
export const OWNER_CLERK_ID_DEFAULT = "user_3KQScMnVPi30zj12OTNSJluvNvK"; // NEU: Owner in Production (clerk.growimo.app), Stand 2026-10-09 — ALT war user_3H2trJXHwzXmJF2XTGQ2PMEwjkD (Dev-Instanz)
export const OWNER_CLERK_ID: string =
  (typeof process !== "undefined" && process.env?.OWNER_CLERK_ID?.trim()) ||
  OWNER_CLERK_ID_DEFAULT;

// ── Alt-IDs des Owners (NUR für Analytik-Filter, NIE für Override) ────────────
// Owner-Entscheidung 2026-10-26 nach der Zugriffs-Forensik: das ALT-Konto des
// Owners aus der Development-Instanz (fahr625@gmail.com, Dev-Ära bis 2026-10-09)
// hat 24 der 65 Analytics-Generierungen erzeugt und taucht im Admin-Bericht
// weiter als echter Nutzer auf, weil der Filter „eigene Tests ausblenden" nur
// die AKTUELLE Owner-ID kennt. Diese Liste schließt die Alt-Konten mit ein.
//
// ⚠ ABGRENZUNG (bewusst getrennt, bitte nicht zusammenlegen):
//   * TEST_USER_IDS (src/lib/tracking.ts) nutzt diese Liste ausschließlich als
//     EXKLUSIONSFILTER in Analytics-Aggregaten.
//   * ADMIN_OVERRIDE_USER_IDS (src/lib/usage-guard.ts) enthält NUR
//     OWNER_CLERK_ID — das Alt-Konto bleibt Free mit Limit 3, es darf über
//     diesen Umweg KEINEN unbegrenzten Override bekommen (Owner-Entscheidung
//     Maßnahme (b), 2026-10-26). Wer die Listen zusammenlegt, hebelt genau
//     diese Entscheidung aus.
export const LEGACY_OWNER_CLERK_IDS: readonly string[] = [
  "user_3H2trJXHwzXmJF2XTGQ2PMEwjkD", // ALT: Owner in der Dev-Instanz (bis 2026-10-09)
];

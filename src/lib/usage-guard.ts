// ── Phase 8.2 Serverseitiges Usage-/Limit-System (Kostenschutz) ───────────────
// Owner-Entscheidung 2026-09-12 (verbindlich):
//   Free = 3 Generierungen EINMALIG (Owner 2026-10-22) · Pro = 200/Monat · 1 Bild = 1 Generierung ·
//   Strategie-Paket = 1 pro Kanal · interne Retries/Scoring/Verbessern = 0.
//
// OWNER-ENTSCHEIDUNG 2026-10-22 (verbindlich, ersetzt das Free-Monatslimit):
//   Free = 3 Generierungen EINMALIG pro Nutzer (kein Monats-Reset), danach ist
//   jede KI-Funktion nur mit aktivem Pro-Abo nutzbar. Pro = unverändert
//   200/Monat. Kündigung eines Pro-Abos setzt das einmalige Gratis-Kontingent
//   NICHT zurück (die Zeile bleibt mit ihrem count bestehen). Bestands-Beta-
//   Nutzer erhalten dieselben 3 einmaligen Gratisgenerierungen; früherer
//   Free-Verbrauch (alte 'YYYY-MM'-Zeilen) zählt ab dem Stichtag nicht mehr.
//   Umsetzung: Free-Verbrauch liegt in der Pseudo-Periode 'once'
//   (FREE_ONCE_PERIOD) — dieselbe atomare, konditionale Mechanik wie Pro,
//   nur ohne Monats-Rollover.
//
// FIX-BLOCK 1 (Owner-Auftrag 2026-10-08, verbindlich): Die TikTok-Diagnose v2
// und der A/B-Varianten-Abruf sind kostenpflichtige KI-Funktionen (vollwertige
// LLM-Generierungen mit neuem Ergebnis) und zählen daher je 1 Generierung —
// sie laufen durch denselben konditionalen Guard wie alle anderen Pfade.
// Unverändert 0 bleiben ausschließlich echte interne Retries, Scoring und
// „Verbessern" (dokumentiert in /home/team/shared/fix-block1-usage-2026-10-08.md).
// Jeder Verbrauch schreibt zusätzlich ein Zuordnungs-Event (usage_events).
//
// Nur von SERVER-seitigem Code importieren (DB + JWKS-Verify) — niemals vom
// Client. Einstiegspunkte: src/api/generate-stream.ts (Strategie-Stream je
// Kanal), src/ai/server.ts (Einzel-Asset / Paket / TikTok), src/routes/app/
// image-studio.tsx (Bild), src/ai/stream.ts (Kanal-Runner).
//
// Design-Entscheidung (dokumentiert): withGenerationGuard RESERVIERT die Einheit
// VOR dem KI-Call via atomarem, konditionalem Increment (INSERT ... ON CONFLICT
// ... WHERE count < limit) und KOMPENSIERT bei Fehlern (Zähler -1). Damit gilt
// die Owner-Regel „nur verbrauchen, wenn erfolgreich" (Fehler/Abort = 0), und
// zusätzlich bleibt das Limit auch bei PARALLELEN Kanälen (Strategie-Stream,
// Paket) exakt eingehalten — ein reines assert-vorher+increment-nachher würde
// bei 10 parallelen Kanälen über das Limit hinausschießen.
import { OWNER_CLERK_ID } from './owner-id';
import { verifySessionSubject } from '../api/tracking';
import {
  qGetPlanTier,
  qGetRemaining,
  qIncrementUsage,
  qInsertUsageEvent,
  qReleaseUsage,
  qTryThrottle,
} from '../db/queries';

export const FREE_ONCE_GRANT = 3;
/**
 * Alias auf {@link FREE_ONCE_GRANT} — Bestandsname für Aufrufer/Suiten, die das
 * Free-Limit unter „FREE_LIMIT" lesen. Einzige Quelle bleibt FREE_ONCE_GRANT
 * (bzw. limitForPlan()); der Alias existiert nur, damit kein Aufrufer still eine
 * zweite, abweichende Zahl mitführt.
 */
export const FREE_LIMIT = FREE_ONCE_GRANT;
/**
 * Pseudo-Periode des EINMALIGEN Free-Kontingents (Owner-Entscheidung
 * 2026-10-22). Kein Monats-Rollover: die Zeile in usage_monthly bleibt für
 * immer bestehen — auch nach einer Kündigung des Pro-Abos (kein Reset).
 */
export const FREE_ONCE_PERIOD = 'once';
export const PRO_LIMIT = 200;
/** Minimaler Abstand zwischen zwei Generierungen desselben Nutzers (Drossel). */
export const RATE_WINDOW_MS = 2000;

// ── Owner-/Admin-Override (intern, NUR Server) ────────────────────────────────
// Owner-Entscheidung 2026-09-12: Der Owner (Clerk-User-ID unten) darf durch das
// Free-5-Limit NICHT blockiert werden und soll frei testen können. Umsetzung:
// hart kodierte, kleine Konstante im Server-Code (keine Env, kein Client-Zugriff
// — dieses Modul wird ausschließlich von serverseitigen Pfaden importiert, siehe
// Header). Betroffene Nutzer sind ausgenommen (unbegrenzt, KEIN Zähler-Increment,
// KEIN Rate-Limit-Block); Beta-Nutzer und alle anderen unterliegen unverändert
// den normalen Tarifregeln (Free 5 / Pro 200). Es gibt KEIN Badge und KEINEN
// UI-Hinweis — der Override ist bewusst unsichtbar.
export const ADMIN_OVERRIDE_USER_IDS: ReadonlySet<string> = new Set([
  // Owner (Clerk-User-ID) — zentral in src/lib/owner-id.ts, dort per Env
  // OWNER_CLERK_ID übersteuerbar (Clerk-Migration, Plan §3.5 Punkt 1).
  OWNER_CLERK_ID,
]);

/** Prüft, ob eine Clerk-User-ID dem internen Admin-/Test-Override unterliegt. */
export function isAdminOverride(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && userId.length > 0 && ADMIN_OVERRIDE_USER_IDS.has(userId);
}

/** Typisierter Fehler: monatliches Generierungs-Limit aufgebraucht. */
export class UsageLimitError extends Error {
  readonly code = 'USAGE_LIMIT';
  readonly remaining: number;
  readonly limit: number;
  readonly planTier: 'free' | 'pro';
  constructor(
    message: string,
    info: { remaining: number; limit: number; planTier: 'free' | 'pro' },
  ) {
    super(message);
    this.name = 'UsageLimitError';
    this.remaining = info.remaining;
    this.limit = info.limit;
    this.planTier = info.planTier;
  }
}

/** Typisierter Fehler: Rate-Drossel (zu kurzer Abstand zwischen Aufrufen). */
export class RateLimitError extends Error {
  readonly code = 'RATE_LIMIT';
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** Aktuelle Monats-Period 'YYYY-MM' (Server-Zeit). */
export function currentPeriod(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Periode, in der das Kontingent des Tarifs liegt:
 *   · free → FREE_ONCE_PERIOD ('once'): einmalig pro Nutzer, KEIN Rollover —
 *     auch ein Monatswechsel oder eine Pro-Kündigung setzt nichts zurück.
 *   · pro  → currentPeriod() ('YYYY-MM'): 200 pro Kalendermonat, Rollover am
 *     Monatsersten (unverändert wie seit 2026-09-12).
 * EINZIGE Stelle, die die Periode tarifabhängig bestimmt — alle Verbrauchs-,
 * Kompensations- und Anzeige-Pfade gehen hier durch.
 */
export function usagePeriodForPlan(
  planTier: 'free' | 'pro',
  d: Date = new Date(),
): string {
  return planTier === 'pro' ? currentPeriod(d) : FREE_ONCE_PERIOD;
}

export function limitForPlan(planTier: 'free' | 'pro'): number {
  return planTier === 'pro' ? PRO_LIMIT : FREE_ONCE_GRANT;
}

/**
 * Limit-Meldung (de/en).
 * Free (Owner-Entscheidung 2026-10-22): KEIN „monatlich" mehr — das Kontingent
 * ist einmalig, danach ist ein Abo nötig. Pro: unverändert monatlich.
 */
export function usageLimitMessage(
  lang: 'de' | 'en',
  planTier: 'free' | 'pro',
  limit: number,
): string {
  if (planTier === 'pro') {
    return lang === 'en'
      ? `Your monthly limit is used up (${limit}/month on the Pro plan). Upgrade for ${PRO_LIMIT} per month.`
      : `Dein monatliches Limit ist aufgebraucht (${limit}/Monat im Pro-Plan). Upgrade für ${PRO_LIMIT} pro Monat.`;
  }
  return lang === 'en'
    ? `Your ${limit} free generations are used up — for more you need a subscription (Pro 19 €/month).`
    : `Deine ${limit} kostenlosen Generierungen sind aufgebraucht — für weitere brauchst du ein Abo (Pro 19 €/Monat).`;
}

export interface UsageInfo {
  used: number;
  remaining: number;
  limit: number;
  planTier: 'free' | 'pro';
  period: string;
}

/**
 * FIX-BLOCK 1 (Owner-Auftrag 2026-10-08) — Zuordnung einer verbrauchten
 * Generierung für das Usage-Event-Ledger (usage_events). Jede Verbrauchsstelle
 * nennt ihre Aktion, damit jede Zähler-Zeile im Nachhinein zuordenbar ist.
 * `detail` trägt Kontext ohne PII (Kanal/Content-Type/Modus), `contentId`
 * einen Ergebnis-Bezug, wenn er serverseitig vorhanden ist.
 */
export interface UsageEventContext {
  /** Technischer Aktions-Schlüssel, z. B. 'tiktok_diagnose', 'ab_variants'. */
  action: string;
  /** Kanal/Content-Type/Modus — frei von PII. */
  detail?: string | null;
  /** Projekt-/Content-UUID, falls vorhanden. */
  contentId?: string | null;
}

/** Zentraler Aktions-Katalog (dokumentiert, welche Aktionen zählen). */
export const USAGE_ACTIONS = {
  generateContent: 'generate_content',
  packageChannel: 'package_channel',
  streamChannel: 'stream_channel',
  tiktokTodayIdea: 'tiktok_todayidea',
  tiktokConcept: 'tiktok_concept',
  tiktokDiagnose: 'tiktok_diagnose',
  abVariants: 'ab_variants',
  image: 'image',
  imageStream: 'image_stream',
} as const;

/** Lese-Info über Kontingent eines Nutzers (clerk_id). Verbraucht nichts. */
export async function getUsageInfo(clerkUserId: string): Promise<UsageInfo> {
  const planTier = await qGetPlanTier(clerkUserId);
  const limit = limitForPlan(planTier);
  const period = usagePeriodForPlan(planTier);
  const remaining = await qGetRemaining(clerkUserId, period, limit);
  return { used: limit - remaining, remaining, limit, planTier, period };
}

/**
 * Reine Prüfung (verbraucht NICHTS): wirft UsageLimitError, wenn 0 übrig.
 * Wird für Early-Fail-Punkte genutzt (z. B. Paket-Kernel: nichts verbrennen,
 * wenn das Kontingent bereits leer ist).
 */
export async function assertCanGenerate(
  clerkUserId: string,
  lang: 'de' | 'en' = 'de',
): Promise<{ ok: true; remaining: number; limit: number; planTier: 'free' | 'pro' }> {
  // Admin-/Owner-Override: sofort ok, unbegrenzt (KEIN Zähler-Increment, KEIN
  // Rate-Limit-Block) — Owner soll frei testen können (Owner-Entscheidung
  // 2026-09-12). Kein Badge/UI-Hinweis: die Ausnahme ist rein intern.
  if (isAdminOverride(clerkUserId)) {
    return { ok: true, remaining: Number.MAX_SAFE_INTEGER, limit: Number.MAX_SAFE_INTEGER, planTier: 'free' };
  }
  const info = await getUsageInfo(clerkUserId);
  if (info.remaining <= 0) {
    throw new UsageLimitError(usageLimitMessage(lang, info.planTier, info.limit), {
      remaining: 0,
      limit: info.limit,
      planTier: info.planTier,
    });
  }
  return { ok: true, remaining: info.remaining, limit: info.limit, planTier: info.planTier };
}

/**
 * Zähler atomar erhöhen (nur wenn unterm Limit). Wirft UsageLimitError am Limit.
 * Nutzung: einfache Einheiten (Einzel-Asset, Bild, TikTok-Konzept), wo ein
 * einzelner vorheriger assertCanGenerate-Aufruf den Parallel-Fall nicht abdeckt.
 */
export async function recordGeneration(
  clerkUserId: string,
  lang: 'de' | 'en' = 'de',
  ctx?: UsageEventContext,
): Promise<{ remaining: number; limit: number; used: number }> {
  // Admin-/Owner-Override: kein Zähler-Increment (Owner frei testen können).
  // Bewusst AUCH KEIN Usage-Event: der Owner läuft ohne Zähler (Vorgabe 8.2,
  // die Ausnahme ist unsichtbar) — das Ledger bleibt deckungsgleich zum Zähler.
  if (isAdminOverride(clerkUserId)) {
    return { remaining: Number.MAX_SAFE_INTEGER, limit: Number.MAX_SAFE_INTEGER, used: 0 };
  }
  const planTier = await qGetPlanTier(clerkUserId);
  const limit = limitForPlan(planTier);
  const period = usagePeriodForPlan(planTier);
  const next = await qIncrementUsage(clerkUserId, period, limit);
  if (next == null) {
    throw new UsageLimitError(usageLimitMessage(lang, planTier, limit), {
      remaining: 0,
      limit,
      planTier,
    });
  }
  // FIX-BLOCK 1: Verbrauch im Ledger festhalten (fail-soft, wirft nie).
  await qInsertUsageEvent(clerkUserId, {
    action: ctx?.action ?? 'generation',
    detail: ctx?.detail ?? null,
    contentId: ctx?.contentId ?? null,
    period,
    countAfter: next,
    limit,
  });
  return { remaining: Math.max(limit - next, 0), limit, used: next };
}

/**
 * Fehlgeschlagene Generierung kompensieren (Zähler −1, mindestens 0).
 * Die Periode wird tarifabhängig bestimmt (free → 'once', pro → 'YYYY-MM'):
 * eine Free-Kompensation darf niemals eine Monatszeile berühren und umgekehrt.
 */
export async function releaseGeneration(clerkUserId: string): Promise<void> {
  const planTier = await qGetPlanTier(clerkUserId);
  await qReleaseUsage(clerkUserId, usagePeriodForPlan(planTier));
}

/**
 * Guard+Increment um einen echten Generierungsaufruf:
 *   1. reserviert atomar (konditionales Increment unter dem Limit),
 *   2. führt fn aus,
 *   3. kompensiert bei Fehlern (netto 0 Verbrauch).
 * Endzustand: Verbrauch NUR bei Erfolg, Limit wird auch parallel nie überschritten.
 * Anonyme/fehlende callerId → sofortiger UsageLimitError-artiger Fehler
 * (fail-closed: keine unguardete Generierung).
 */
export async function withGenerationGuard<T>(
  callerId: string | null | undefined,
  fn: () => Promise<T>,
  lang: 'de' | 'en' = 'de',
  ctx?: UsageEventContext,
): Promise<T> {
  if (!callerId) {
    throw new Error(
      lang === 'en'
        ? 'No valid session — please sign in again.'
        : 'Keine gültige Sitzung — bitte neu anmelden.',
    );
  }
  // Admin-/Owner-Override: unbegrenzt — keinerlei DB-Reservierung/-Increment,
  // der Call läuft direkt durch (Owner frei testen können). Bewusst auch KEIN
  // Usage-Event (kein Zähler ⇒ kein Ledger-Eintrag, Vorgabe 8.2 bleibt sichtbar
  // unverändert).
  if (isAdminOverride(callerId)) {
    return fn();
  }
  const planTier = await qGetPlanTier(callerId);
  const limit = limitForPlan(planTier);
  const period = usagePeriodForPlan(planTier);
  const next = await qIncrementUsage(callerId, period, limit);
  if (next == null) {
    throw new UsageLimitError(usageLimitMessage(lang, planTier, limit), {
      remaining: 0,
      limit,
      planTier,
    });
  }
  try {
    const result = await fn();
    // FIX-BLOCK 1: NUR ein erfolgreicher Lauf ist ein Verbrauch — der Eintrag
    // entsteht nach Erfolg, damit das Ledger netto exakt dem Zähler entspricht
    // (kompensierte Fehlläufe schreiben nichts).
    await qInsertUsageEvent(callerId, {
      action: ctx?.action ?? 'generation',
      detail: ctx?.detail ?? null,
      contentId: ctx?.contentId ?? null,
      period,
      countAfter: next,
      limit,
    });
    return result;
  } catch (err) {
    try {
      await qReleaseUsage(callerId, period);
    } catch {
      // Kompensation darf den Originalfehler nie verschlucken.
    }
    throw err;
  }
}

/**
 * Drossel: wirft RateLimitError, wenn der letzte Aufruf dieses Nutzers innerhalb
 * des Fensters (Default 2 s) liegt. Fenster via opts.minIntervalMs übersteuerbar
 * (Tests). Wird auf interaktiven Einstiegspunkten aufgerufen (Einzel-Asset,
 * Bild, TikTok, Verbessern, Paket-Start, Stream-Start) — NICHT auf parallelen
 * Kanal-Calls (Paket-Kanäle/Stream-Kanäle), damit Bulk-Flows nicht fälschlich
 * blockiert werden.
 */
export async function assertRateOk(
  clerkUserId: string | null | undefined,
  opts: { minIntervalMs?: number; lang?: 'de' | 'en' } = {},
): Promise<void> {
  if (!clerkUserId) return; // keine Identität → kein Throttle-Eintrag
  // Admin-/Owner-Override: KEIN Rate-Limit-Block (Owner frei testen können).
  if (isAdminOverride(clerkUserId)) return;
  const windowMs = opts.minIntervalMs ?? RATE_WINDOW_MS;
  const lang = opts.lang ?? 'de';
  if (windowMs <= 0) return;
  const ok = await qTryThrottle(clerkUserId, windowMs);
  if (!ok) {
    throw new RateLimitError(
      lang === 'en'
        ? 'Too many requests. Please wait a moment.'
        : 'Zu viele Anfragen. Bitte einen Moment warten.',
    );
  }
}

/**
 * Nutzer-Identität aus einer ServerFn-Anfrage auflösen.
 *
 * Owner-Entscheidung 2026-10-26 (Maßnahme (c) aus der Zugriffs-Forensik):
 * ES GIBT NUR NOCH EINEN WEG — das serverseitig JWKS-verifizierte
 * `__session`-Cookie. Der frühere Payload-Fallback (`data.userId` aus dem
 * Request-Body) ist vollständig entfernt: er erlaubte theoretisch, fremdes
 * Kontingent zu verbrauchen oder ein fremdes Konto zu adressieren, ohne je
 * benötigt zu werden — jeder echte Aufruf kommt aus der eingeloggten App und
 * schickt das Cookie mit.
 *
 * Rückgabe `null` = keine verifizierte Identität (Aufrufer entscheidet
 * fail-closed; die Generierungspfade tun das über `requireUserIdFromServerFn`).
 *
 * getRequest wird LAZY importiert, damit dieses Modul auch in Nicht-h3-Kontexten
 * (Unit-Tests, Bun-Skripte) importierbar bleibt.
 *
 * Import-Quelle: '@tanstack/start-server-core/request-response' statt des
 * '@tanstack/react-start/server'-Barrels. Grund (Build-Fix Phase 8.2 Abschluss):
 * der Barrel re-exportiert `* from "@tanstack/start-server-core"` und zieht damit
 * createStartHandler.js in den vercel-bundle (bun build vercel-entry.ts), dessen
 * dynamische Importe `#tanstack-router-entry` / `#tanstack-start-entry` nur das
 * TanStack-Vite-Plugin auflöst — rohes `bun build` scheitert daran. Das Submodul
 * importiert nur node:async_hooks + h3-v2 und exportiert dieselbe getRequest-Funktion.
 */
export async function resolveUserIdFromServerFn(): Promise<string | null> {
  try {
    const { getRequest } = await import('@tanstack/start-server-core/request-response');
    const req = getRequest() as unknown as Request;
    const cookie = req.headers?.get?.('cookie') ?? '';
    if (cookie.includes('__session=')) {
      const sub = await verifySessionSubject(req);
      if (sub) return sub;
    }
  } catch {
    // kein h3-Kontext (Tests/Skripte) oder ungültige Session → keine Identität
  }
  return null;
}

/**
 * P3-Härtung (Owner-Entscheidung 2026-10-22) — Identitäts-Gate, FAIL-CLOSED.
 *
 * Die 5 0-Einheiten-Pfade (Verbessern/Auto-Verbessern/Priorisieren) laufen
 * bewusst OHNE try/catch um dieses Gate: wer keine gültige Sitzung hat, ist
 * weder Free- noch Pro-Nutzer und darf die KI nicht erreichen. Der Fehler
 * wird deshalb NICHT geschluckt — er bricht den Aufruf ab (kein stiller
 * Gratis-KI-Call ohne Session).
 *
 * Ausgelagert aus `src/ai/server.ts`, damit der Fail-closed-Vertrag ohne
 * Start-Compiler auf Guard-Ebene testbar ist (kontingent-once-test, Punkt k).
 */
export async function requireUserIdFromServerFn(): Promise<string> {
  const uid = await resolveUserIdFromServerFn();
  if (!uid) {
    throw new Error('Keine gültige Sitzung — bitte neu anmelden.');
  }
  return uid;
}
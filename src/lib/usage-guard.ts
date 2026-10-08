// ── Phase 8.2 Serverseitiges Usage-/Limit-System (Kostenschutz) ───────────────
// Owner-Entscheidung 2026-09-12 (verbindlich):
//   Free = 5 Generierungen/Monat · Pro = 200/Monat · 1 Bild = 1 Generierung ·
//   Strategie-Paket = 1 pro Kanal · interne Retries/Scoring/Verbessern = 0.
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
import { verifySessionSubject } from '../api/tracking';
import {
  qGetPlanTier,
  qGetRemaining,
  qIncrementUsage,
  qInsertUsageEvent,
  qReleaseUsage,
  qTryThrottle,
} from '../db/queries';

export const FREE_LIMIT = 5;
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
  'user_3H2trJXHwzXmJF2XTGQ2PMEwjkD', // Owner (Clerk-User-ID)
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

export function limitForPlan(planTier: 'free' | 'pro'): number {
  return planTier === 'pro' ? PRO_LIMIT : FREE_LIMIT;
}

/** Exakte, vom Owner vorgegebene Limit-Meldung (de/en). */
export function usageLimitMessage(
  lang: 'de' | 'en',
  planTier: 'free' | 'pro',
  limit: number,
): string {
  return lang === 'en'
    ? `Your monthly limit is used up (${limit}/month on the ${planTier === 'pro' ? 'Pro' : 'Free'} plan). Upgrade for ${PRO_LIMIT} per month.`
    : `Dein monatliches Limit ist aufgebraucht (${limit}/Monat im ${planTier === 'pro' ? 'Pro' : 'Free'}-Plan). Upgrade für ${PRO_LIMIT} pro Monat.`;
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
  const period = currentPeriod();
  const remaining = await qGetRemaining(clerkUserId, planTier, period);
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
  const period = currentPeriod();
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

/** Fehlgeschlagene Generierung kompensieren (Zähler −1, mindestens 0). */
export async function releaseGeneration(clerkUserId: string): Promise<void> {
  await qReleaseUsage(clerkUserId, currentPeriod());
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
  const period = currentPeriod();
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
 * Nutzer-Identität aus einer ServerFn-Anfrage auflösen:
 *   1. __session-Cookie (JWKS-verifiziert — autoritativ, verhindert
 *      Quota-Diebstahl über gefälschte payload-userId),
 *   2. Fallback: vom Aufrufer mitgeschickte payload-userId (bestehende
 *      Aufrufer wie fetchPackageKernelServer schicken userId mit) — nur wenn
 *      kein Cookie verifiziert werden konnte,
 *   3. null → Aufrufer entscheidet (fail-closed bei Generierung).
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
export async function resolveUserIdFromServerFn(payloadFallback?: string): Promise<string | null> {
  try {
    const { getRequest } = await import('@tanstack/start-server-core/request-response');
    const req = getRequest() as unknown as Request;
    const cookie = req.headers?.get?.('cookie') ?? '';
    if (cookie.includes('__session=')) {
      const sub = await verifySessionSubject(req);
      if (sub) return sub;
    }
  } catch {
    // kein h3-Kontext (Tests/Skripte) → Fallback unten
  }
  // Sicherheit (Admin-/Owner-Override): Die Owner-ID darf NIE aus dem
  // Request-Body stammen — nur aus der serverseitig JWKS-verifizierten
  // Session (__session-Cookie). Eine im Payload mitgeschickte Admin-ID wird
  // verworfen (→ null, fail-closed): damit ist der Override für normale
  // Nutzer unerreichbar (keine Client-Zugriffsmöglichkeit auf die Ausnahme).
  const payload = payloadFallback && payloadFallback.trim() ? payloadFallback.trim() : null;
  if (payload && isAdminOverride(payload)) return null;
  return payload;
}
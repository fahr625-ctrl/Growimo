// ─────────────────────────────────────────────────────────────────────────────
// WIDERRUFSRECHT IM CHECKOUT — ENTSCHEIDUNGS-LAYER (ENTWURF 2026-10-24)
// ─────────────────────────────────────────────────────────────────────────────
// STATUS: ENTWURF. Dieses Modul ist der Code-Teil der Owner-Entscheidung
// „Widerrufsrecht bei KI-SaaS-Abonnement". Es ist NICHT deployed und ändert
// KEIN Verhalten, solange der ServerFn-Gate in `checkout.ts` nicht ausgerollt
// wird (Gate ist fail-closed: ohne Zustimmung wird KEINE Checkout-Session
// gebaut, sobald der Code live ist).
//
// RECHTSRAHMEN (zitiert, nicht interpretiert):
//   § 312g Abs. 1 BGB  — Widerrufsrecht bei Fernabsatzverträgen.
//   § 355 Abs. 1 BGB   — 14 Tage, ohne Begründung.
//   § 356 Abs. 2 Nr. 1
//     lit. a BGB       — Fristbeginn bei Dienstleistungsverträgen: Tag des
//                        Vertragsschlusses (nicht Lieferung).
//   § 356 Abs. 4 BGB   — Erlöschen bei Verträgen über digitale Inhalte (nicht
//                        auf körperlichem Datenträger), wenn der Unternehmer
//                        mit der Ausführung begonnen hat, nachdem der
//                        Verbraucher ausdrücklich zugestimmt hat UND bestätigt
//                        hat, dass er dadurch sein Widerrufsrecht verliert.
//   § 356 Abs. 5 BGB   — Erlöschen bei Dienstleistungsverträgen NUR, wenn die
//                        Dienstleistung VOLLSTÄNDIG erbracht ist, zusätzlich
//                        zu ausdrücklicher Zustimmung + Kenntnisnahmebestätigung.
//   § 357a Abs. 1 BGB  — Wertersatz, wenn der Verbraucher den Beginn der
//                        Dienstleistung vor Ablauf der Widerrufsfrist
//                        ausdrücklich verlangt hat.
//   § 361 Abs. 2 BGB   — von diesen Vorschriften darf zum Nachteil des
//                        Verbrauchers nicht abgewichen werden (eine zu weite
//                        Erlöschens-Klausel ist unwirksam).
//
// WICHTIG (Grund, warum hier KEIN pauschales „Widerrufsrecht erlischt" steht):
// Ein Growimo-Pro-Abo ist ein laufzeitgebundenes Dienstleistungsabonnement.
// Die Leistung ist während der ersten 14 Tage NICHT vollständig erbracht
// (§ 356 Abs. 5 BGB verlangt genau das). Ein Erlöschen tritt deshalb frühestens
// mit vollständiger Erbringung ein; bis dahin bleibt das Widerrufsrecht
// bestehen und es greift — bei ausdrücklichem Verlangen des vorzeitigen
// Beginns — der Wertersatz nach § 357a Abs. 1 BGB. Die Zustimmung ist damit
// kein „Widerruf abschaffen", sondern die Voraussetzung dafür, dass wir
// überhaupt vorzeitig beginnen dürfen und im Widerrufsfall anteilig abrechnen
// können.
// ─────────────────────────────────────────────────────────────────────────────

/** Art der Einwilligung, wie sie in `checkout_consents.kind` gespeichert wird. */
export const WIDERRUF_CONSENT_KIND = 'widerruf_early_start' as const;

/**
 * Version des Zustimmungstextes. MUSS bei jeder inhaltlichen Änderung des
 * Checkbox-Textes erhöht werden — gespeicherte Zustimmungen bleiben sonst auf
 * einen Text zeigen, den der Nutzer nie gesehen hat. Der Wert wird zusammen mit
 * der Zustimmung persistiert (Nachweisfunktion, Art. 7 Abs. 1 DSGVO-Analogie).
 */
export const WIDERRUF_CONSENT_VERSION = '2026-10-24-v1' as const;

/**
 * Zwei kompatible Wege (Owner-Entscheidung, siehe Entwurfsordner):
 *
 *   'required' (Variante ii, EMPFEHLUNG):
 *     Checkout nur mit ausdrücklicher Zustimmung zum vorzeitigen Beginn +
 *     Kenntnisnahmebestätigung. Nur dann ist § 356 Abs. 4/5 BGB überhaupt
 *     anwendbar und nur dann entsteht der Wertersatzanspruch aus § 357a Abs. 1
 *     BGB.
 *
 *   'off' (Variante i):
 *     Kein vorzeitiger Beginn, kein Checkbox-Zwang. Dafür: 14 Tage volles
 *     Widerrufsrecht ohne Wertersatz — der Kunde bekommt bei Widerruf alles
 *     zurück, auch wenn er in den 14 Tagen 200 Generierungen verbraucht hat.
 *
 * Der Default ist bewusst 'required' (fail-closed): Wird die Env-Variable
 * vergessen, verlangt das System die Zustimmung, statt sie still wegzulassen.
 */
export type EarlyStartMode = 'required' | 'off';

export interface ConsentEnv {
  WIDERRUF_EARLY_START?: string;
}

/** Liest den Modus aus der Env. Nur ein explizites „off" schaltet die Checkbox ab. */
export function earlyStartMode(env: ConsentEnv = process.env as ConsentEnv): EarlyStartMode {
  const raw = String(env.WIDERRUF_EARLY_START ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === '0' || raw === 'no') return 'off';
  return 'required';
}

/** Fehlercode für den Client — bewusst stabil und übersetzbar. */
export const WIDERRUF_CONSENT_REQUIRED_CODE = 'widerruf_consent_required' as const;

export class WiderrufConsentError extends Error {
  code = WIDERRUF_CONSENT_REQUIRED_CODE;
  constructor(message = 'Widerruf consent required before checkout') {
    super(message);
    this.name = 'WiderrufConsentError';
  }
}

export interface EarlyStartConsentInput {
  /** Zustimmung des Nutzers (Checkbox). Alles außer `true` gilt als „nicht zugestimmt". */
  earlyStartConsent?: unknown;
  /** Optional: Textversion, die der Client angezeigt hat. */
  consentVersion?: unknown;
}

export type ConsentDecision =
  | { ok: true; required: false; reason: 'mode_off'; version: string }
  | { ok: true; required: true; reason: 'consented'; version: string }
  | { ok: false; required: true; reason: 'consent_missing'; version: string }
  | { ok: false; required: true; reason: 'consent_version_mismatch'; version: string };

/**
 * Reine Entscheidungsfunktion (keine I/O, vollständig testbar).
 *
 * Fail-closed-Regeln:
 *  - Modus 'required' + kein `true` → nicht ok.
 *  - Modus 'required' + abweichende `consentVersion` → nicht ok. Der Client
 *    muss die Version mitschicken, die er angezeigt hat; eine veraltete
 *    Zustimmung (Nutzer hat einen alten Text gesehen) darf nie als Zustimmung
 *    zum neuen Text durchgehen.
 *  - Modus 'off' → ok, ohne Zustimmung (Variante i).
 */
export function evaluateEarlyStartConsent(
  input: EarlyStartConsentInput | undefined,
  mode: EarlyStartMode = earlyStartMode(),
): ConsentDecision {
  if (mode === 'off') {
    return { ok: true, required: false, reason: 'mode_off', version: WIDERRUF_CONSENT_VERSION };
  }
  if (input?.earlyStartConsent !== true) {
    return {
      ok: false,
      required: true,
      reason: 'consent_missing',
      version: WIDERRUF_CONSENT_VERSION,
    };
  }
  const version =
    typeof input.consentVersion === 'string' && input.consentVersion.trim()
      ? input.consentVersion.trim()
      : '';
  if (version !== WIDERRUF_CONSENT_VERSION) {
    return {
      ok: false,
      required: true,
      reason: 'consent_version_mismatch',
      version: WIDERRUF_CONSENT_VERSION,
    };
  }
  return { ok: true, required: true, reason: 'consented', version: WIDERRUF_CONSENT_VERSION };
}

/** Wirft bei fehlender/ungültiger Zustimmung — der Aufrufer baut dann KEINE Session. */
export function assertEarlyStartConsent(
  input: EarlyStartConsentInput | undefined,
  mode: EarlyStartMode = earlyStartMode(),
): ConsentDecision {
  const decision = evaluateEarlyStartConsent(input, mode);
  if (!decision.ok) throw new WiderrufConsentError();
  return decision;
}

/** Ein zu speichernder Zustimmungs-Datensatz (Nachweis). */
export interface ConsentRecord {
  kind: typeof WIDERRUF_CONSENT_KIND;
  textVersion: string;
  clerkUserId: string;
  priceLookupKey: string | null;
  /** ISO-Zeitpunkt der Zustimmung (Serverzeit). */
  acceptedAt: string;
}

/**
 * Baut den Nachweis-Datensatz. Bewusst OHNE IP-Adresse und ohne User-Agent:
 * für den Nachweis genügen Konto, Zeitpunkt, Textversion und Preis. Keine
 * zusätzlichen personenbezogenen Daten an dieser Stelle.
 */
export function buildConsentRecord(input: {
  clerkUserId: string;
  priceLookupKey?: string | null;
  acceptedAt?: Date;
}): ConsentRecord {
  if (!input.clerkUserId || input.clerkUserId === 'anonymous') {
    throw new Error('buildConsentRecord requires a real clerk user id');
  }
  return {
    kind: WIDERRUF_CONSENT_KIND,
    textVersion: WIDERRUF_CONSENT_VERSION,
    clerkUserId: input.clerkUserId,
    priceLookupKey: input.priceLookupKey ?? null,
    acceptedAt: (input.acceptedAt ?? new Date()).toISOString(),
  };
}

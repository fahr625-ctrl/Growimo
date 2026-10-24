// ─────────────────────────────────────────────────────────────────────────────
// E-MAIL-REGELN FÜR `users.email` — rein, ohne I/O (Owner-Auftrag 2026-10-24)
// ─────────────────────────────────────────────────────────────────────────────
// BEFUND (2026-10-23/24): Der Generierungs-Flow rief `ensureUserRow(userId)` OHNE
// E-Mail auf. Der Upsert schrieb dann `anon-<clerkId>@growimo.local` in
// `users.email` — auch bei einem Nutzer, der sich gerade mit einer ECHTEN
// Adresse angemeldet hatte. Folge: `isBetaUserEmail()` (Beta-Rabatt 50 % hängt
// an `users.email` → `beta_signups`) findet nichts mehr, und der Nutzer verliert
// still seinen lebenslangen Beta-Rabatt.
//
// Dieses Modul enthält NUR die Entscheidung, welcher Wert geschrieben wird —
// keine DB, kein Netz. Die SQL-Ausführung steht in `queries.ts`
// (`ensureUserRow`), die Session-Ermittlung in `src/lib/session-email.ts`.
//
// REGELN (Owner-Vorgabe 2026-10-24, verbindlich):
//   1. Eine vorhandene ECHTE E-Mail wird NIE durch einen Platzhalter ersetzt.
//   2. Ein `anon-…@growimo.local`-Platzhalter DARF durch die echte
//      Session-E-Mail ersetzt werden (Heilung).
//   3. Beim NEUANLEGEN wird die Session-E-Mail direkt gesetzt.
//   4. Ohne Session-E-Mail: wie bisher der Platzhalter (kein Crash).
// ─────────────────────────────────────────────────────────────────────────────

/** Domain der Platzhalter-Adressen. Bewusst `.local` — nicht zustellbar. */
export const ANON_EMAIL_DOMAIN = 'growimo.local';

/** Erkennt `anon-<irgendwas>@growimo.local` (case-insensitiv). */
const ANON_EMAIL_RE = /^anon-[^@\s]*@growimo\.local$/i;

/** Grobe, absichtlich permissive E-Mail-Prüfung (nur „sieht echt aus"). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmt und normalisiert eine E-Mail; alles Unbrauchbare → null. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

/** Ist der Wert ein Growimo-Platzhalter (`anon-…@growimo.local`)? */
export function isPlaceholderEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return ANON_EMAIL_RE.test(value.trim());
}

/**
 * Echte, zustellbare E-Mail? `false` für Platzhalter, leere Werte und Müll.
 * Genau diese Prüfung entscheidet, ob eine Zeile „geheilt" werden darf.
 */
export function isRealEmail(value: unknown): boolean {
  const normalized = normalizeEmail(value);
  if (!normalized) return false;
  return !isPlaceholderEmail(normalized);
}

/** Der Platzhalter, der bisher (und weiterhin als Fallback) geschrieben wird. */
export function placeholderEmailFor(clerkId: string): string {
  return `anon-${clerkId}@${ANON_EMAIL_DOMAIN}`;
}

/**
 * Herkunft der geschriebenen E-Mail. Bewusst als geschlossene Union, damit
 * Tests jede Regel einzeln adressieren können und Logs eindeutig sind.
 */
export type UserEmailSource =
  /** Neuanlage mit echter Session-E-Mail (Regel 3). */
  | 'created_with_session_email'
  /** Neuanlage mit vom Aufrufer übergebener echter E-Mail. */
  | 'created_with_provided_email'
  /** Neuanlage ohne jede echte E-Mail → Platzhalter (Regel 4). */
  | 'created_placeholder'
  /** Platzhalter durch echte Session-E-Mail ersetzt (Regel 2, Heilung). */
  | 'healed_placeholder'
  /** Vorhandene echte E-Mail bleibt (Regel 1). */
  | 'kept_existing_real'
  /** Echte E-Mail vom Aufrufer ersetzt eine vorhandene echte (Adresswechsel). */
  | 'updated_by_provided_email'
  /** Vorhandene leere/NULL-E-Mail wird mit echter Session-E-Mail gefüllt. */
  | 'filled_empty_with_session_email'
  /** Platzhalter bleibt Platzhalter (keine Session-E-Mail vorhanden). */
  | 'kept_placeholder';

export interface UserEmailDecision {
  /** Wert, der in `users.email` geschrieben wird. Nie leer. */
  email: string;
  source: UserEmailSource;
  /** Wurde die vorhandene Zeile tatsächlich verändert? */
  changed: boolean;
  /** War die vorhandene E-Mail ein Platzhalter, der jetzt geheilt wird? */
  healed: boolean;
}

export interface DecideUserEmailInput {
  clerkId: string;
  /** Aktueller Wert in `users.email` — `undefined` = Zeile existiert nicht. */
  existingEmail?: string | null;
  /** Vom Aufrufer explizit übergebene E-Mail (z. B. app-shell `ensureUser`). */
  providedEmail?: unknown;
  /** Echte E-Mail aus der Clerk-Session, falls ermittelbar. */
  sessionEmail?: unknown;
  /** Zeile existiert bereits? Default: `existingEmail !== undefined`. */
  rowExists?: boolean;
}

/**
 * Entscheidet, welche E-Mail geschrieben wird. REIN — keine Seiteneffekte.
 *
 * Priorität der QUELLE: explizit übergebene E-Mail > Session-E-Mail >
 * vorhandener Wert > Platzhalter.
 *
 * Die drei Owner-Regeln in Kurzform:
 *   · Regel 1: ein Platzhalter überschreibt NIE eine echte E-Mail.
 *   · Regel 2: eine echte Session-E-Mail heilt einen Platzhalter.
 *   · Regel 3: bei der Neuanlage gewinnt die Session-E-Mail sofort.
 *   · Regel 4: ohne jede echte E-Mail bleibt es beim Platzhalter.
 */
export function decideUserEmail(input: DecideUserEmailInput): UserEmailDecision {
  const { clerkId } = input;
  const rowExists = input.rowExists ?? input.existingEmail !== undefined;
  const existingRaw = input.existingEmail ?? null;
  const existingReal = isRealEmail(existingRaw);
  const providedReal = isRealEmail(input.providedEmail);
  const sessionReal = isRealEmail(input.sessionEmail);
  const provided = providedReal ? normalizeEmail(input.providedEmail)! : null;
  const session = sessionReal ? normalizeEmail(input.sessionEmail)! : null;
  const placeholder = placeholderEmailFor(clerkId);

  // ── Neuanlage (Regel 3 + 4) ────────────────────────────────────────────────
  if (!rowExists) {
    if (provided) {
      return { email: provided, source: 'created_with_provided_email', changed: true, healed: false };
    }
    if (session) {
      return { email: session, source: 'created_with_session_email', changed: true, healed: false };
    }
    return { email: placeholder, source: 'created_placeholder', changed: true, healed: false };
  }

  // ── Bestandszeile: echte E-Mail vorhanden ──────────────────────────────────
  if (existingReal) {
    const existing = normalizeEmail(existingRaw)!;
    // Ein explizit übergebener echter Wert darf eine echte Adresse ersetzen
    // (Adresswechsel über die app-shell `ensureUser`). Ein Platzhalter NIE.
    if (provided && provided.toLowerCase() !== existing.toLowerCase()) {
      return {
        email: provided,
        source: 'updated_by_provided_email',
        changed: true,
        healed: false,
      };
    }
    return { email: existing, source: 'kept_existing_real', changed: false, healed: false };
  }

  // ── Bestandszeile: Platzhalter oder leer ───────────────────────────────────
  const wasPlaceholder = isPlaceholderEmail(existingRaw);
  if (provided) {
    return {
      email: provided,
      source: wasPlaceholder ? 'healed_placeholder' : 'updated_by_provided_email',
      changed: normalizeEmail(existingRaw) !== provided,
      healed: wasPlaceholder,
    };
  }
  if (session) {
    return {
      email: session,
      source: wasPlaceholder ? 'healed_placeholder' : 'filled_empty_with_session_email',
      changed: normalizeEmail(existingRaw) !== session,
      healed: wasPlaceholder,
    };
  }
  return {
    email: wasPlaceholder ? normalizeEmail(existingRaw)! : placeholder,
    source: 'kept_placeholder',
    changed: false,
    healed: false,
  };
}

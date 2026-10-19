// ─────────────────────────────────────────────────────────────────────────────
// K4-B — reine Logik der dauerhaften Bildspeicherung (Owner-Freigabe 2026-10-19)
// ─────────────────────────────────────────────────────────────────────────────
// Diese Datei enthält AUSSCHLIESSLICH reine Funktionen: kein Netz, keine DB,
// kein Blob, kein `process.env`-Zugriff ausser in den expliziten Parser-Funktionen
// (die den Env-Wert als Argument bekommen). Damit ist die gesamte Entscheidungs-
// logik (Sliding Window, TTL, Guard, Zugriffsrechte, Cron-Auth) ohne Kosten und
// ohne Postgres prüfbar — siehe generated-images-logic-test.ts.
//
// Verbindliche Quelle der Parameter: DESIGN-FREEZE-2026-10-19.md, Abschnitt 1.
// Hausregel „nur versprechen, was geliefert wird": der globale Byte-Guard ist
// FAIL-CLOSED — ein unparsbarer Env-Wert schaltet den Schutz NICHT ab, sondern
// fällt auf den Default zurück.

// ── Parameter (Defaults aus dem Design-Freeze) ───────────────────────────────

/** Max. dauerhaft gespeicherte Originale je Nutzer (Owner-Zusage). */
export const IMAGE_MAX_PER_USER_DEFAULT = 200;
/** Aufbewahrungsfrist in Tagen ab Erstellung (Owner-Zusage). */
export const IMAGE_TTL_DAYS_DEFAULT = 90;
/** Globaler Byte-Guard (Hobby): 850 MB gespeicherte Bytes, danach Ablehnung. */
export const IMAGE_GLOBAL_BYTES_CAP_DEFAULT = 850_000_000;
/** Warnschwelle: Banner + Fehleranalyse-Eintrag, damit der Owner vorzeitig handelt. */
export const IMAGE_GLOBAL_WARN_BYTES_DEFAULT = 700_000_000;

/** Prompt wird auf 400 Zeichen gekappt (Datensparsamkeit, Rechtstexte-Entwurf). */
export const IMAGE_PROMPT_MAX_CHARS = 400;

/** Erlaubte Löschgründe (Whitelist, identisch zum DB-CHECK). */
export const IMAGE_DELETE_REASONS = ['cap_200', 'ttl_90d', 'account_deleted', 'manual'] as const;
export type ImageDeleteReason = (typeof IMAGE_DELETE_REASONS)[number];

export function isValidDeleteReason(value: unknown): value is ImageDeleteReason {
  return typeof value === 'string' && (IMAGE_DELETE_REASONS as readonly string[]).includes(value);
}

// ── Env-Parser (fail-closed) ─────────────────────────────────────────────────

/** Positive Ganzzahl aus einem Env-Wert; `null` bei unparsbar/leer/<= 0. */
export function parsePositiveInt(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Guard-Deckel aus dem Env-Wert. Verbindliche Wertetabelle (Design-Freeze §1):
 *   nicht gesetzt / leer  → Default 850 MB (Guard AN)
 *   `0` oder `off`        → Guard AUS (0)
 *   Zahl > 0              → genau dieser Wert
 *   unparsbar / negativ   → Default 850 MB (ein Tippfehler darf den Schutz NIE
 *                           stillschweigend abschalten)
 */
export function resolveGlobalBytesCap(raw: string | undefined | null): number {
  if (raw === undefined || raw === null) return IMAGE_GLOBAL_BYTES_CAP_DEFAULT;
  const trimmed = String(raw).trim().toLowerCase();
  if (!trimmed) return IMAGE_GLOBAL_BYTES_CAP_DEFAULT;
  if (trimmed === '0' || trimmed === 'off') return 0;
  const n = parsePositiveInt(trimmed);
  return n ?? IMAGE_GLOBAL_BYTES_CAP_DEFAULT;
}

/** Warnschwelle (nie über dem Deckel, sonst wäre die Warnung sinnlos). */
export function resolveGlobalWarnBytes(
  raw: string | undefined | null,
  cap: number = IMAGE_GLOBAL_BYTES_CAP_DEFAULT,
): number {
  const parsed = raw === undefined || raw === null || !String(raw).trim()
    ? IMAGE_GLOBAL_WARN_BYTES_DEFAULT
    : parsePositiveInt(String(raw).trim()) ?? IMAGE_GLOBAL_WARN_BYTES_DEFAULT;
  if (cap > 0 && parsed > cap) return cap;
  return parsed;
}

export interface ImageLimits {
  maxPerUser: number;
  ttlDays: number;
  globalBytesCap: number;
  globalWarnBytes: number;
}

/** Alle K4-B-Parameter aus der Umgebung (ein Aufruf, eine Wahrheit). */
export function resolveImageLimits(env: Record<string, string | undefined> = {}): ImageLimits {
  const cap = resolveGlobalBytesCap(env.IMAGE_GLOBAL_BYTES_CAP);
  return {
    maxPerUser: parsePositiveInt(env.IMAGE_MAX_PER_USER) ?? IMAGE_MAX_PER_USER_DEFAULT,
    ttlDays: parsePositiveInt(env.IMAGE_TTL_DAYS) ?? IMAGE_TTL_DAYS_DEFAULT,
    globalBytesCap: cap,
    globalWarnBytes: resolveGlobalWarnBytes(env.IMAGE_GLOBAL_WARN_BYTES, cap),
  };
}

// ── TTL ──────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** `expires_at = created_at + ttlDays` — EINE Wahrheit, kein DB-Default. */
export function computeExpiresAt(createdAt: Date | number, ttlDays: number = IMAGE_TTL_DAYS_DEFAULT): Date {
  const base = createdAt instanceof Date ? createdAt.getTime() : createdAt;
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? Math.floor(ttlDays) : IMAGE_TTL_DAYS_DEFAULT;
  return new Date(base + days * DAY_MS);
}

/**
 * Zeitstempel tolerant in Millisekunden umrechnen.
 *
 * WARUM (belegter Befund aus der Phase-2b-Integrations-Suite): Postgres liefert
 * `timestamptz` je nach Treiber entweder als Date, als Zahl ODER als String — und
 * im String-Format mit LEERZEICHEN statt „T" und mit MIKROSEKUNDEN
 * („2026-10-19 10:35:12.345678+00"). `new Date(...)` liefert dafür `NaN`, und ein
 * `NaN` hätte in `isExpired` stillschweigend „abgelaufen → 410" ergeben: ein
 * GÜLTIGES Bild wäre für den Nutzer verschwunden. Deshalb wird hier normalisiert
 * (Trenner, Bruchteile auf Millisekunden gekürzt, „+00" → „+00:00"); wer trotzdem
 * unparsbar bleibt, gilt fail-closed als abgelaufen.
 */
export function toEpochMs(value: Date | number | string): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(' ', 'T');
  s = s.replace(/(\.\d{3})\d+/, '$1');
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** Genau auf der Frist gilt als GÜLTIG (abgelaufen erst danach) — „> NOW()". */
export function isExpired(expiresAt: Date | number | string, now: number = Date.now()): boolean {
  const at = toEpochMs(expiresAt);
  if (at === null) return true; // unbrauchbarer Wert = fail-closed abgelaufen
  return at <= now;
}

// ── Guard ────────────────────────────────────────────────────────────────────

export type GuardReason = 'ok' | 'capacity';

/**
 * Entscheidet über eine NEUE Speicherung. `capBytes <= 0` heißt Guard AUS.
 * Genaue Grenze: `liveBytes + newSizeBytes <= cap` ⇒ erlaubt (der Deckel ist
 * erlaubt, erst das Überschreiten wird abgelehnt — inklusive Race-Zuschlag von
 * genau einem Bild).
 */
export function guardDecision(args: {
  capBytes: number;
  liveBytes: number;
  newSizeBytes: number;
}): GuardReason {
  const { capBytes, liveBytes, newSizeBytes } = args;
  if (!Number.isFinite(capBytes) || capBytes <= 0) return 'ok';
  const live = Number.isFinite(liveBytes) && liveBytes > 0 ? liveBytes : 0;
  const add = Number.isFinite(newSizeBytes) && newSizeBytes > 0 ? newSizeBytes : 0;
  return live + add <= capBytes ? 'ok' : 'capacity';
}

/** Warnschwelle erreicht (Banner + Fehleranalyse), Deckel noch nicht erreicht. */
export function isGuardWarning(args: { capBytes: number; warnBytes: number; liveBytes: number }): boolean {
  const { capBytes, warnBytes, liveBytes } = args;
  if (!Number.isFinite(capBytes) || capBytes <= 0) return false;
  if (!Number.isFinite(warnBytes) || warnBytes <= 0) return false;
  return liveBytes >= warnBytes && liveBytes < capBytes;
}

/** Rest-Kapazität in Bytes (nie negativ) — für ehrliche UI-Zahlen. */
export function remainingBytes(capBytes: number, liveBytes: number): number {
  if (!Number.isFinite(capBytes) || capBytes <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, capBytes - Math.max(0, liveBytes));
}

// ── Sliding Window ───────────────────────────────────────────────────────────

export interface WindowRow {
  id: string;
  createdAt: Date | number;
}

/**
 * Überhang des Fensters: alle Zeilen AUSSER den `maxPerUser` neuesten. Die
 * Eingabe ist aufsteigend sortiert (`created_at ASC, id ASC`) und wird hier
 * deterministisch (gleicher Zeitstempel ⇒ gleiche Reihenfolge) ausgewertet —
 * markierte Zeilen zählen NICHT mit, weil die Abfrage sie schon ausfiltert.
 */
export function selectOverflow<T extends WindowRow>(rows: readonly T[], maxPerUser: number): T[] {
  const limit = Number.isFinite(maxPerUser) && maxPerUser > 0 ? Math.floor(maxPerUser) : 0;
  if (rows.length <= limit) return [];
  return rows.slice(0, rows.length - limit);
}

/** Deterministische Sortierung (aufsteigend) der Fenster-Kandidaten. */
export function sortWindowAsc<T extends WindowRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const at = a.createdAt instanceof Date ? a.createdAt.getTime() : a.createdAt;
    const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : b.createdAt;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── Zugriffsrechte / HTTP-Semantik ───────────────────────────────────────────

export type ImageAccessStatus = 401 | 403 | 404 | 410 | 200;

export interface ImageAccessArgs {
  /** `users.id` (UUID) des Anfragenden — null = keine gültige Session. */
  requesterUserId: string | null;
  /** Zeile gefunden? */
  found: boolean;
  /** `generated_images.user_id` der gefundenen Zeile. */
  imageUserId?: string | null;
  /** Bereits gelöscht (markiert)? */
  deleted?: boolean;
  /** Frist abgelaufen? */
  expired?: boolean;
}

/**
 * Reihenfolge ist verbindlich: erst Session (401), dann Eigentum (403), dann
 * Existenz (404), dann Ablauf (410), sonst 200. Ein FREMDES Bild ist immer 403 —
 * auch wenn es abgelaufen wäre (keine Information über fremde Bilder).
 */
export function imageAccessStatus(args: ImageAccessArgs): ImageAccessStatus {
  if (!args.requesterUserId) return 401;
  if (!args.found) return 404;
  if (!args.imageUserId || args.imageUserId !== args.requesterUserId) return 403;
  if (args.deleted === true) return 410;
  if (args.expired === true) return 410;
  return 200;
}

// ── Pfade / Bytes / Auth ─────────────────────────────────────────────────────

/** Deterministischer, privater Blob-Pfad: `images/<users.id>/<uuid>`. */
export function buildBlobPath(userId: string, fileId: string): string {
  return `images/${userId}/${fileId}`;
}

/** Pfad-Präfix eines Nutzers (für den einmaligen Orphan-Check). */
export function blobPrefixForUser(userId: string): string {
  return `images/${userId}/`;
}

export interface DecodedDataUrl {
  bytes: Uint8Array;
  mimeType: string;
  base64Length: number;
}

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp|avif));base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * Dekodiert eine `data:image/...;base64,...`-URL. Fail-closed: unbekannter Typ
 * oder kaputter Inhalt ⇒ `null` (dann wird NICHT gespeichert, aber auch nichts
 * Falsches gespeichert).
 */
export function decodeImageDataUrl(dataUrl: unknown): DecodedDataUrl | null {
  if (typeof dataUrl !== 'string') return null;
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const base64 = match[2].replace(/\s+/g, '');
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytes.length === 0) return null;
    return { bytes, mimeType, base64Length: base64.length };
  } catch {
    return null;
  }
}

/** Prompt auf 400 Zeichen kappen; `` (leer) ⇒ null (keine leeren Strings in der DB). */
export function capPrompt(prompt: unknown): string | null {
  if (typeof prompt !== 'string') return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  return trimmed.length > IMAGE_PROMPT_MAX_CHARS ? trimmed.slice(0, IMAGE_PROMPT_MAX_CHARS) : trimmed;
}

/** Projekt-Zuordnung: leere/ungültige Werte werden zu `null` (SET-NULL-Semantik). */
export function normalizeProjectId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Cron-Authentifizierung — FAIL-CLOSED: ohne `CRON_SECRET` antwortet die Route
 * IMMER 401 (nie offen), und der Vergleich ist exakt (Bearer + voller Wert).
 */
export function cronAuthOk(args: { secret: string | undefined | null; authorization: string | null }): boolean {
  const secret = typeof args.secret === 'string' ? args.secret.trim() : '';
  if (!secret) return false;
  return args.authorization === `Bearer ${secret}`;
}

/** Dateiendung/Vorschau-Hinweis: ehrliche Anzeige der gespeicherten Größe. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${Math.max(1, Math.round(mb * 1000))} KB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** Gallerie-Kappung für die Meta-Liste (die echte Grenze ist der 200er-Cap). */
export const IMAGE_LIST_LIMIT_DEFAULT = 200;

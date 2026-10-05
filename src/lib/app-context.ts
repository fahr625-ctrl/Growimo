/**
 * Stabilisierung Schritt 4 (Punkt 6) — durchgängiger Workflow: EIN zentrales,
 * versioniertes Kontext-Objekt.
 *
 * Befund (Analyse, bestätigt): Der Kontext zwischen den Modulen reiste bisher
 * ausschließlich in fünf feature-eigenen sessionStorage-Keys
 * (`growimo_strategy_prefill`, `growimo_tiktok_last_result`,
 * `growimo_beta_access_v1`, Galerie, last-saved-package) — jeder mit eigenem
 * Format. Ein Modul, das nur „welches Projekt / welche Produktidee war das?“
 * braucht, musste eines dieser Formate kennen.
 *
 * Dieser Baustein ist bewusst ADDITIV und klein: er ersetzt KEINEN der
 * bestehenden Keys (die bleiben unangetastet, inkl. `growimo_strategy_prefill`
 * aus Schritt 3) und wird nur dort gelesen, wo vorher gar kein Kontext ankam —
 * konkret:
 *   - Projekt-Detail → TikTok-Werkstatt („🎵 TikTok-Konzept aus diesem Projekt“):
 *     `tiktok.tsx` wählt das Projekt anhand `readContext().projectId` vor, wenn
 *     der Nutzer nicht selbst schon eines gewählt hat.
 *   - „🎨 Bild erstellen“-Aktionen schreiben die Herkunft mit, damit das
 *     Bild-Studio den passenden Rückweg anbieten kann.
 *
 * Muster wie `~/lib/last-result` / `~/lib/tiktok-recent`: Versionsfeld, TTL,
 * fail-closed beim Lesen (kaputtes/fremdes JSON ⇒ null, nie ein halber Wert).
 */

/** sessionStorage-Schlüssel des Workflow-Kontexts. */
export const APP_CONTEXT_KEY = 'growimo_app_context';
/** Format-Version — fremde/ältere Einträge werden ignoriert statt interpretiert. */
export const APP_CONTEXT_VERSION = 1;
/** TTL: 24 h (ein Arbeitstag). sessionStorage ist ohnehin pro Tab flüchtig. */
export const APP_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
/** Obergrenze der Produktidee, damit kein ganzer Prompt im Kontext landet. */
export const APP_CONTEXT_IDEA_MAX_CHARS = 280;

/** Bekannte Herkunftsmodule — unbekannte Werte werden verworfen (fail-closed). */
export const APP_CONTEXT_SOURCES = [
  'package',
  'project',
  'strategy',
  'library',
  'tiktok',
  'dashboard',
] as const;

export type AppContextSource = (typeof APP_CONTEXT_SOURCES)[number];

/** Der transportierte Kontext. Alle Felder optional — fehlt etwas, bleibt es leer. */
export interface AppContext {
  projectId?: string;
  productIdea?: string;
  /** Aus welchem Modul der Nutzer kam (steuert Rückwege/„Weiter mit …“). */
  source?: AppContextSource;
  /** Stand des Markenprofil-Schalters (Phase 1, C4) zum Zeitpunkt des Schritts. */
  brandEnabled?: boolean;
}

interface StoredAppContext extends AppContext {
  version: number;
  savedAt: number;
}

function cleanString(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

/**
 * Normalisiert beliebige Eingaben zu einem gültigen Kontext (fail-closed):
 * falscher Typ ⇒ Feld wird WEGGELASSEN (nicht: halber Wert), Quatsch-Quelle ⇒
 * keine Quelle. `brandEnabled: false` ist ein gültiger Wert und überlebt.
 */
export function sanitizeAppContext(input: unknown): AppContext {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const out: AppContext = {};
  const projectId = cleanString(raw.projectId, 100);
  if (projectId) out.projectId = projectId;
  const productIdea = cleanString(raw.productIdea, APP_CONTEXT_IDEA_MAX_CHARS);
  if (productIdea) out.productIdea = productIdea;
  if (typeof raw.source === 'string' && (APP_CONTEXT_SOURCES as readonly string[]).includes(raw.source)) {
    out.source = raw.source as AppContextSource;
  }
  if (typeof raw.brandEnabled === 'boolean') out.brandEnabled = raw.brandEnabled;
  return out;
}

/**
 * Führt zwei Kontexte zusammen. Ein bereits gesetzter Wert wird nur von einem
 * NEUEN, gesetzten Wert überschrieben — `undefined` löscht nichts. Damit kann
 * jeder Schritt den Kontext punktuell ergänzen, ohne den Rest zu verlieren.
 */
export function mergeAppContext(prev: AppContext | null, patch: AppContext): AppContext {
  const base: AppContext = prev ? { ...prev } : {};
  const next: AppContext = { ...base };
  if (patch.projectId !== undefined) next.projectId = patch.projectId;
  if (patch.productIdea !== undefined) next.productIdea = patch.productIdea;
  if (patch.source !== undefined) next.source = patch.source;
  if (patch.brandEnabled !== undefined) next.brandEnabled = patch.brandEnabled;
  return next;
}

/** Serialisiert versioniert (reine Funktion, testbar). */
export function serializeAppContext(context: AppContext, now: number = Date.now()): string {
  const payload: StoredAppContext = { version: APP_CONTEXT_VERSION, ...context, savedAt: now };
  return JSON.stringify(payload);
}

/**
 * Liest + validiert einen Eintrag. null bei fehlendem/defektem JSON, falscher
 * Version, fehlendem `savedAt` oder abgelaufener TTL — der Aufrufer fällt dann
 * auf „kein Kontext“ zurück, nie auf einen Crash.
 */
export function parseAppContext(
  raw: string | null,
  now: number = Date.now(),
  ttlMs: number = APP_CONTEXT_TTL_MS,
): AppContext | null {
  if (!raw) return null;
  let parsed: Partial<StoredAppContext>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredAppContext>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.version !== APP_CONTEXT_VERSION) return null;
  if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return null;
  if (Number.isFinite(ttlMs) && ttlMs > 0 && now - parsed.savedAt > ttlMs) return null;
  const context = sanitizeAppContext(parsed);
  return Object.keys(context).length > 0 ? context : null;
}

/** Schreibt den Kontext (additiv, gemerged) in die sessionStorage. Nie werfend. */
export function rememberContext(patch: AppContext, now: number = Date.now()): AppContext {
  const safePatch = sanitizeAppContext(patch);
  let merged = safePatch;
  try {
    merged = mergeAppContext(parseAppContext(sessionStorage.getItem(APP_CONTEXT_KEY), now), safePatch);
    sessionStorage.setItem(APP_CONTEXT_KEY, serializeAppContext(merged, now));
  } catch {
    /* sessionStorage nicht verfügbar — Kontext bleibt im Aufrufer-State */
  }
  return merged;
}

/** Liest den Kontext (null = kein brauchbarer Kontext vorhanden). */
export function readContext(now: number = Date.now()): AppContext | null {
  try {
    return parseAppContext(sessionStorage.getItem(APP_CONTEXT_KEY), now);
  } catch {
    return null;
  }
}

/** Bewusstes Zurücksetzen (z. B. „Neue Sitzung“). */
export function clearContext(): void {
  try {
    sessionStorage.removeItem(APP_CONTEXT_KEY);
  } catch {
    /* sessionStorage nicht verfügbar */
  }
}

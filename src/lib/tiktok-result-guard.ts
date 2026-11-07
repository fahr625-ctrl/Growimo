/**
 * TikTok-Werkstatt — Guard für GESPEICHERTE Ergebnisse (Härtung 2026-11-06).
 *
 * ── Der Fehler (belegt) ───────────────────────────────────────────────────────
 * Ein gespeichertes TikTok-Ergebnis, dem Felder fehlen, sprengte die GANZE
 * TikTok-Route: `TypeError: Cannot read properties of undefined (reading
 * 'length')` → Error-Boundary („Something went wrong!"), `tiktok-*.js`.
 * Ursache: `parseTikTokResult()` / `parseRecentList()` prüften nur
 * `result.mode`; die Lesestellen der Route verlangen aber mehr — mindestens
 * `r.overlays.length`, `r.scenes.map(...)`, `r.spokenText.trim()`.
 *
 * ── Was dieser Guard tut (und was NICHT) ─────────────────────────────────────
 * Er prüft ein gespeichertes Ergebnis GEGEN DEN RENDER-VERTRAG der Route
 * (`src/routes/app/tiktok.tsx`, `ResultView`, Zeilennummern s. Feldtabelle
 * unten) — und zwar ausschließlich lesend:
 *   • KEINE Löschung, KEINE Umschreibung, KEINE Migration gespeicherter Daten.
 *   • KEINE Reparatur (kein Auffüllen fehlender Felder mit Defaults): ein
 *     Ergebnis, das der Nutzer nie bekommen hat, wird auch nicht angezeigt.
 *   • KEINE Mutation des übergebenen Objekts (reine Lese-Prüfung).
 * Ungültige Einträge werden vom Aufrufer IGNORIERT (wie „kein Ergebnis") —
 * gültige Ergebnisse gehen UNVERÄNDERT (identisches Objekt, kein Feld
 * hinzugefügt/entfernt/verändert) an die Anzeige, rendern also exakt wie bisher.
 *
 * ── Gewählte Behandlung „nur teilweise brauchbar" (mildeste Variante) ───────
 * 1. Geprüft wird NUR, was die Anzeige tatsächlich ungeschützt liest. Kein
 *    Feld, das die Route nicht anfasst, wird verlangt (z. B. `selfCheck`,
 *    unbekannte Zusatzfelder bleiben erlaubt und werden durchgereicht).
 * 2. Optionale Felder, die die Route per Kurzschluss überspringt (falsy), sind
 *    in JEDEM falsy-Zustand zulässig (`null`/`undefined`/`''`/`0`/`false`) —
 *    genau so verhält sich der Renderer: `r.format && …`, `r.timedScenes && …`.
 *    Ein truthy Wert falschen Typs (z. B. `timedScenes: "abc"`) ist dagegen ein
 *    Absturz und macht den Eintrag ungültig.
 * 3. Ein einzelnes kaputtes Feld macht den EINTRAG ungültig, nie die Liste:
 *    `parseRecentList` überspringt ihn und behält die übrigen gültigen Einträge
 *    (sichtbar + öffenbar). Das ist die mildeste Variante ohne Absturz — und
 *    ohne Datenverlust, weil der Eintrag im sessionStorage unangetastet bleibt
 *    und nur nicht angezeigt wird.
 * 4. Warum nicht „so viel wie möglich anzeigen" (Feld für Feld reparieren)?
 *    Ein halb gerendertes Ergebnis (z. B. Szenenplan mit 1 von 6 Szenen, oder
 *    eine Aufnahme-Anleitung ohne Sprechtext) sähe vollständig aus, obwohl es
 *    unvollständig ist — der Nutzer würde danach filmen. Nicht anzeigen ist
 *    ehrlicher und für den Nutzer gefahrlos (er kann neu generieren), während
 *    das Ignorieren nachweislich nichts löscht.
 *
 * Reine Funktionen, keine Seiteneffekte, kein React, kein LLM, keine
 * sessionStorage-Zugriffe → direkt in Bun-Tests prüfbar.
 */

/** Ergebnis der Prüfung: gültig, oder ungültig mit deutschem Kurzgrund. */
export interface TikTokResultGuardVerdict {
  ok: boolean;
  /** Kurzgrund bei `ok === false` (für Tests/Diagnose, nie für den Nutzer). */
  reason?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === 'string';

/** Nicht-leere Zeichenkette? (Nur für Diagnose-Zweige, s. u.) */
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Zeitgestempelte Szene: `{ time, scene, text }` — alle drei Strings.
 *  `s.text.trim()` (tiktok.tsx:288/373/380) verlangt zwingend einen String. */
function isTimedScene(v: unknown): boolean {
  if (!isObject(v)) return false;
  return isString(v.time) && isString(v.scene) && isString(v.text);
}

/** Bild-/Videoidee: `{ description, studioPrompt }` (tiktok.tsx:431/435/439). */
function isImageIdea(v: unknown): boolean {
  if (!isObject(v)) return false;
  return isString(v.description) && isString(v.studioPrompt);
}

/** Optionale Liste: falsy ist zulässig (der Renderer überspringt sie dann),
 *  truthy muss eine Liste gültiger Elemente sein. */
function optionalListOk(v: unknown, item: (x: unknown) => boolean): boolean {
  if (!v) return true;
  return Array.isArray(v) && v.every(item);
}

/** Optionales Feld, das die Route per `!== undefined` prüft und dann `.trim()`
 *  ruft (tiktok.tsx:345 scrollStop, :404 tension): `null` stürzt dort ab →
 *  nur `undefined` oder ein String sind zulässig. */
function optionalTrimmedStringOk(v: unknown): boolean {
  return v === undefined || isString(v);
}

/** Optionales Feld, das die Route per Truthiness prüft (`r.format && …`,
 *  `r.title && …`): falsy zulässig, truthy muss String sein. */
function optionalStringOk(v: unknown): boolean {
  return !v || isString(v);
}

/** Diagnose v2 — `rebuilt` (tiktok.tsx:271–309): falsy zulässig, truthy muss
 *  das Objekt mit allen gelesenen Feldern sein. `seconds` wird nur per
 *  `String(...)` ausgegeben → jeder Typ ist dort absturzsicher. */
function rebuiltOk(v: unknown): boolean {
  if (!v) return true;
  if (!isObject(v)) return false;
  if (!isString(v.hook) || !isString(v.voiceover) || !isString(v.cta)) return false;
  if (!Array.isArray(v.timedScenes) || !v.timedScenes.every(isTimedScene)) return false;
  return true;
}

/** Phase 3 — `lengthRecommendation` (tiktok.tsx:314–323): falsy zulässig,
 *  truthy braucht `structure` + `reason` als Strings (`seconds` nur String(...)). */
function lengthRecommendationOk(v: unknown): boolean {
  if (!v) return true;
  if (!isObject(v)) return false;
  return isString(v.structure) && isString(v.reason);
}

/**
 * Prüft, ob ein gespeichertes Ergebnis von `ResultView` OHNE Absturz gerendert
 * werden kann. Entscheidet nach `result.mode` — genau wie der Renderer
 * (tiktok.tsx:224 dataGap → :245 diagnose → sonst Idee-Zweig).
 *
 * @param result beliebiger gespeicherter Wert (JSON.parse-Ergebnis)
 * @returns `{ ok: true }` oder `{ ok: false, reason }`
 */
export function guardTikTokResult(result: unknown): TikTokResultGuardVerdict {
  if (!isObject(result)) return { ok: false, reason: 'kein Objekt' };
  const mode = result.mode;
  if (!isString(mode)) return { ok: false, reason: 'mode fehlt' };

  // ── Diagnose-Zweig ────────────────────────────────────────────────────────
  if (mode === 'diagnose') {
    if (result.dataGap) {
      // „zu wenig Daten"-Zustand (tiktok.tsx:224–243): note, missingMetrics, cta.
      if (!isString(result.note)) return { ok: false, reason: 'dataGap.note fehlt' };
      if (!isStringArray(result.missingMetrics)) {
        return { ok: false, reason: 'dataGap.missingMetrics fehlt' };
      }
      if (!isString(result.cta)) return { ok: false, reason: 'dataGap.cta fehlt' };
      return { ok: true };
    }
    // Volle Diagnose (tiktok.tsx:245–331).
    if (!isString(result.biggestProblem)) return { ok: false, reason: 'biggestProblem fehlt' };
    if (!isStringArray(result.whatWorks)) return { ok: false, reason: 'whatWorks fehlt' };
    if (!isStringArray(result.whatToImprove)) return { ok: false, reason: 'whatToImprove fehlt' };
    if (!isString(result.newHook)) return { ok: false, reason: 'newHook fehlt' };
    if (!isString(result.optimized)) return { ok: false, reason: 'optimized fehlt' };
    if (!isString(result.nextTest)) return { ok: false, reason: 'nextTest fehlt' };
    if (!rebuiltOk(result.rebuilt)) return { ok: false, reason: 'rebuilt unvollständig' };
    if (!lengthRecommendationOk(result.lengthRecommendation)) {
      return { ok: false, reason: 'lengthRecommendation unvollständig' };
    }
    return { ok: true };
  }

  // ── Idee-Zweig (todayIdea/concept — und jeder unbekannte Modus, den der
  //    Renderer ebenfalls hier landet) ────────────────────────────────────────
  if (!isString(result.idea)) return { ok: false, reason: 'idea fehlt' };
  if (!isString(result.hook)) return { ok: false, reason: 'hook fehlt' };
  if (!isString(result.length)) return { ok: false, reason: 'length fehlt' };
  if (!isStringArray(result.scenes)) return { ok: false, reason: 'scenes fehlt' };
  if (!isStringArray(result.overlays)) return { ok: false, reason: 'overlays fehlt' };
  if (!isString(result.spokenText)) return { ok: false, reason: 'spokenText fehlt' };
  if (!isString(result.caption)) return { ok: false, reason: 'caption fehlt' };
  if (!isStringArray(result.hashtags)) return { ok: false, reason: 'hashtags fehlt' };
  if (!isString(result.cta)) return { ok: false, reason: 'cta fehlt' };
  if (!isString(result.why)) return { ok: false, reason: 'why fehlt' };
  if (!optionalTrimmedStringOk(result.scrollStop)) return { ok: false, reason: 'scrollStop ungültig' };
  if (!optionalTrimmedStringOk(result.tension)) return { ok: false, reason: 'tension ungültig' };
  if (!optionalStringOk(result.format)) return { ok: false, reason: 'format ungültig' };
  if (!optionalStringOk(result.title)) return { ok: false, reason: 'title ungültig' };
  if (!optionalListOk(result.timedScenes, isTimedScene)) {
    return { ok: false, reason: 'timedScenes ungültig' };
  }
  if (!optionalListOk(result.imageIdeas, isImageIdea)) {
    return { ok: false, reason: 'imageIdeas ungültig' };
  }
  return { ok: true };
}

/** Type-Guard-Fassade für Aufrufer, die nur „ja/nein" brauchen. */
export function isRenderableTikTokResult(result: unknown): boolean {
  return guardTikTokResult(result).ok;
}

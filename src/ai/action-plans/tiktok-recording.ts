// ── TikTok Phase 4: Aufnahme-/Umsetzungs-Checkliste (F5-Muster, NEU) ─────────
// Deterministischer (LLM-freier) Builder nach dem Vorbild der F5-Kanal-
// Aktionspläne (src/ai/action-plans/rules.ts — buildActionPlan/PLAN_BUILDERS/
// hasActionPlan, nur als Vorlage gelesen). Er erzeugt aus einem TikTok-Ergebnis
// (TikTokIdeaResult: hook, timedScenes/scenes, spokenText/overlays, imageIdeas,
// caption, hashtags, cta, title) eine konkrete, sofort umsetzbare
// „Aufnahme-Anleitung": Zubehör/Set-up, Reihenfolge der Aufnahmen je Szene mit
// Zeitangaben, Text-Einsprüche je Szene, Bild-Assets via Image-Studio,
// Posting-Liste und Qualitäts-Checkliste. Reine Funktionen, kein LLM, wirft nie.
// Bewusst EIGENES Interface/Exports — nur der TikTok-Flow nutzt diesen Builder;
// die bestehenden F5-Builder (rules.ts/index.ts/extract.ts) bleiben unverändert.
import type { TikTokIdeaResult, TikTokTimedScene } from '../tiktok';

export type TikTokRecordingLang = 'de' | 'en';

export interface TikTokRecordingStep {
  /** 1-basierte Position in der Checkliste. */
  step: number;
  /** Kurz-Titel der Aktion (im UI fett). */
  action: string;
  /** Konkrete Anweisung — referenziert die echten Inhalte des TikTok-Ergebnisses
   *  (Szene, Zeit, Text, studioPrompt, Titel, Caption, Hashtags, CTA). */
  detail: string;
  /** Prüfbares „Fertig, wenn"-Kriterium. */
  doneCriteria: string;
}

export interface TikTokRecordingPlan {
  /** Referenz auf das TikTok-Ergebnis (Hook als assetRef). */
  assetRef: string;
  plan: TikTokRecordingStep[];
  /** Regeln-Version, damit sich die Anleitung weiterentwickeln kann,
   *  ohne bestehende Konsumenten zu brechen. */
  ruleVersion: number;
}

export const TIKTOK_RECORDING_RULE_VERSION = 1;

function scenesWithTiming(result: TikTokIdeaResult): Array<{ time?: string; text: string }> {
  if (result.timedScenes && result.timedScenes.length > 0) {
    return result.timedScenes.map((s: TikTokTimedScene) => ({ time: s.time, text: s.text }));
  }
  // Fallback für ältere Outputs ohne timedScenes: Szenenliste ohne Zeitmarken
  // (Zeit wird dann anhand der empfohlenen Länge grob zugeordnet — siehe Builder).
  return result.scenes.map((s) => ({ text: s }));
}

/** Teilt eine Gesamtlänge (Sekunden) grob auf die Szenen auf — NUR für den
 *  Fallback, wenn timedScenes fehlen; Position 0 = Start, letzte = Ende. */
function fallbackTime(i: number, count: number): { from: number; to: number } {
  if (count <= 1) return { from: 0, to: 0 };
  const from = Math.round((i / count) * 10) / 10;
  const to = Math.round(((i + 1) / count) * 10) / 10;
  return { from, to };
}

/**
 * Baut die Aufnahme-/Umsetzungs-Checkliste aus einem TikTok-Ergebnis (de/en).
 * @returns den Plan, oder null wenn das Ergebnis nicht nutzbar ist (z. B. keine
 *          Idee/kein Hook — Diagnose-Ergebnisse kommen hier nicht in Frage).
 */
export function buildTikTokRecordingPlan(
  result: TikTokIdeaResult | null | undefined,
  lang: TikTokRecordingLang = 'de',
): TikTokRecordingPlan | null {
  try {
    if (!result || typeof result.hook !== 'string' || !result.hook.trim()) return null;
    const de = lang === 'de';
    const plan: TikTokRecordingStep[] = [];
    let counter = 0;
    const add = (action: string, detail: string, doneCriteria: string) => {
      counter += 1;
      plan.push({ step: counter, action, detail, doneCriteria });
    };

    // ── 1) Zubehör & Set-up ────────────────────────────────────────────────
    const props = (result.imageIdeas ?? []).slice(0, 3).map((i) => i.description).filter(Boolean);
    const propsText =
      props.length > 0
        ? props.join(de ? ', ' : ', ')
        : de
          ? 'das Objekt/Produkt, um das es im Video geht (aus der Idee)'
          : 'the object/product the video is about (from the idea)';
    add(
      de ? 'Zubehör & Set-up vorbereiten' : 'Prepare gear & set-up',
      de
        ? `Stelle bereit: Smartphone/Handy (vertikal, 9:16), Stativ oder feste Ablage, gutes Licht (Fensterlicht frontal oder Lampe), ruhiger, aufgeräumter Hintergrund. Requisiten für dieses Video: ${propsText}. Halte die App/den Bildschirm bereit, den du zeigen willst (echte Bildschirmaufnahme, keine Fake-Screens).`
        : `Get ready: phone (vertical, 9:16), tripod or a solid stand, good light (window light from the front or a lamp), quiet tidy background. Props for this video: ${propsText}. Have the app/screen you want to show ready (real screen recording, no fake screens).`,
      de
        ? 'Kamera vertikal fixiert, Licht steht, alle Requisiten griffbereit.'
        : 'Camera fixed vertically, light in place, all props within reach.',
    );

    // ── 2..N) Aufnahme je Szene (Reihenfolge + Zeitangabe + Text-Einspruch) ─
    const scenes = scenesWithTiming(result);
    scenes.forEach((s, i) => {
      const timing =
        s.time && s.time.trim()
          ? s.time
          : de
            ? `ca. ${fallbackTime(i, scenes.length).from}–${fallbackTime(i, scenes.length).to} Sekunden`
            : `approx. ${fallbackTime(i, scenes.length).from}–${fallbackTime(i, scenes.length).to} seconds`;
      const textPart =
        s.text && s.text.trim()
          ? de
            ? ` Sprich/blende in dieser Szene ein: „${s.text.trim()}“.`
            : ` Speak / show as overlay in this scene: “${s.text.trim()}”.`
          : de
            ? ' Kein Text in dieser Szene.'
            : ' No text in this scene.';
      add(
        de ? `Szene ${i + 1} aufnehmen (${timing})` : `Record scene ${i + 1} (${timing})`,
        de
          ? `Reihenfolge: Szene ${i + 1} zuerst aufnehmen, genau wie beschrieben — Zeitmarke ${timing} einhalten.${textPart}`
          : `Order: record scene ${i + 1} first, exactly as described — keep the time mark ${timing}.${textPart}`,
        de ? 'Die Aufnahme entspricht der Szenenbeschreibung und der Zeitmarke.' : 'The take matches the scene description and the time mark.',
      );
    });

    // ── Sprechtext gesamt + Einblendungen ───────────────────────────────────
    const spoken = result.spokenText && result.spokenText.trim() ? result.spokenText.trim() : '';
    const overlays = (result.overlays ?? []).filter(Boolean).slice(0, 5);
    const speechDetail = de
      ? `Sprechtext: ${spoken || 'kein separater Sprechtext (Szenen-Texte oben reichen).'}${overlays.length > 0 ? ` Einblendungen: ${overlays.join(' · ')}.` : ''}`
      : `Spoken script: ${spoken || 'no separate spoken script (scene texts above are enough).'}${overlays.length > 0 ? ` Overlays: ${overlays.join(' · ')}.` : ''}`;
    add(
      de ? 'Sprechtext & Einblendungen einspielen' : 'Record spoken text & overlays',
      speechDetail,
      de
        ? 'Sprechtext und alle Einblendungen sind im Schnitt enthalten und lesbar.'
        : 'Spoken text and all overlays are in the cut and readable.',
    );

    // ── Bild-Assets aus imageIdeas via Image-Studio ─────────────────────────
    (result.imageIdeas ?? []).forEach((img, i) => {
      add(
        de ? `Bild-Asset ${i + 1} im Image-Studio erzeugen` : `Create image asset ${i + 1} in the Image Studio`,
        de
          ? `Für „${img.description}": Öffne Growimos Image-Studio und füge exakt diesen Prompt ein: „${img.studioPrompt}“. Nutze das Bild als Cover/Thumbnail, Requisiten-Vorlage oder Szene-Einstellung.`
          : `For “${img.description}”: open Growimo's Image Studio and paste exactly this prompt: “${img.studioPrompt}”. Use the image as cover/thumbnail, prop reference or scene setting.`,
        de ? `Bild ist erzeugt und in das Video eingebunden (oder als Cover genutzt).` : 'Image is generated and used in the video (or as the cover).',
      );
    });

    // ── Posting-Liste (Titel, Caption, Hashtags, CTA) ───────────────────────
    const title = result.title && result.title.trim() ? result.title.trim() : result.hook.trim().slice(0, 60);
    const hashtags = (result.hashtags ?? []).join(' ');
    add(
      de ? 'Posting-Liste ausfüllen (Titel, Caption, Hashtags, CTA)' : 'Fill in the posting list (title, caption, hashtags, CTA)',
      de
        ? `Titel: „${title}“. Caption: „${result.caption.trim()}“. Hashtags: ${hashtags}. CTA: „${result.cta.trim()}“. Alles direkt beim Upload einfügen.`
        : `Title: “${title}”. Caption: “${result.caption.trim()}”. Hashtags: ${hashtags}. CTA: “${result.cta.trim()}”. Paste all of it directly on upload.`,
      de ? 'Titel, Caption, Hashtags und CTA sind kopierfertig und eingefügt.' : 'Title, caption, hashtags and CTA are copy-ready and pasted.',
    );

    // ── Qualitäts-Checkliste ────────────────────────────────────────────────
    add(
      de ? 'Qualitäts-Check vor dem Upload' : 'Quality check before uploading',
      de
        ? 'Prüfe: (1) Der Hook steht in den ersten 1–2 Sekunden (gesprochen + eingeblendet). (2) Keine erfundenen Kennzahlen, Erfolgsversprechen oder Fake-Reaktionen („Wow!“, „Da staunen alle“) im Text — nur belegte Fakten. (3) Alle Einblendungen sind lesbar und kurz. (4) Das Video endet mit dem CTA. (5) Format passt (vertikal, 9:16), Ton klar verständlich.'
        : 'Check: (1) The hook is in the first 1–2 seconds (spoken + on screen). (2) No invented metrics, success promises or prescribed reactions (“Wow!”, “everyone is amazed”) in the text — only backed facts. (3) All overlays are readable and short. (4) The video ends with the CTA. (5) Format fits (vertical, 9:16), audio is clear.',
      de
        ? 'Alle fünf Punkte sind abgehakt — dann erst hochladen.'
        : 'All five points are checked off — only then upload.',
    );

    if (plan.length < 3) return null;
    const assetRef = result.hook.trim().slice(0, 120);
    return { assetRef, plan, ruleVersion: TIKTOK_RECORDING_RULE_VERSION };
  } catch {
    return null;
  }
}
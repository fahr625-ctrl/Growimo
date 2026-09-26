// ── TikTok-Bereich: eigenständige, additiv ergänzte Entscheidungs-Engine ────
// Growimo liefert KEINEN leeren Chat — hier werden konkrete TikTok-Entscheidungen
// erzeugt. Drei Modi (je eine GPT-4o-Frage, json_object-Antwort, strukturell
// validiert und für das UI in Felder zerlegt):
//   todayIdea : Growimo entwickelt SELBST eine passende Videoidee (Unternehmen +
//               Ziel reichen — der Nutzer nennt KEINE Videoart).
//   concept   : Nutzer gibt zusätzlich ein Thema/Produkt/grobe Idee vor.
//   diagnose  : Nutzer gibt echte Metriken an → Analyse + neuer Hook +
//               optimierte Version + nächster Test.
//
// Implementierungs-Entscheidung (dokumentiert, pragmatisch): Die Ergebnisse
// werden NUR im UI dargestellt und NICHT in generated_content persistiert.
// Eine Persistenz würde eine DB-Migration erfordern (content_type-Check-
// Constraint erlaubt derzeit kein 'tiktok_idea'); der Owner will primär die
// Erweiterung. Kein bestehendes Feature/Typ wird dadurch verändert.
import OpenAI from 'openai';
import { hasMetricPattern, sanitizeUnbackedMetrics } from './metric-guard';
import {
  isTiktokIdeaDirection,
  pickTodayIdeaDirection,
  tiktokDirectionLabel,
} from '../lib/tiktok-directions';

export type TikTokMode = 'todayIdea' | 'concept' | 'diagnose';
export type TikTokLang = 'de' | 'en';

/** Phase 4 — Projekt-Kontext (lesend, optional): kompakter Faktenblock aus
 *  einem vom Nutzer gewählten Projekt (PostgreSQL). Nur vorhandene Felder werden
 *  übernommen; 'brief' ist der vorgerenderte F6-Strategie-Brief-Extrakt (de/en).
 *  Die Engine behandelt diesen Block als zusätzliche FAKTENQUELLE (wie den
 *  MARKENKONTEXT): sie nutzt ausschließlich diese Felder und erfindet nichts. */
export interface TikTokProjectContext {
  /** Projekt-ID (nur zur Referenz; wird nicht persistiert). */
  projectId?: string;
  /** Projekttitel (existiert immer in der DB). */
  title?: string;
  /** productIdea des Projekts. */
  productIdea?: string;
  /** Strategie-Brief-Extrakt (vorgerendert, nur vorhandene Felder). */
  brief?: string;
}

// Alle Felder optional: Phase 1 trennt „0" von „fehlt" — nur tatsächlich
// angegebene Werte werden in den Prompt übernommen (fehlende werden weggelassen).
export interface TikTokMetrics {
  views?: number;
  length?: string; // z.B. "31s"
  avgWatch?: number; // Sekunden durchschnittliche Wiedergabedauer
  likes?: number;
  comments?: number;
  shares?: number;
  profileVisits?: number;
}

export interface TikTokInput {
  mode: TikTokMode;
  biz: string; // kurze Unternehmens-/Produktbeschreibung (Pflicht, ODER brandContext vorhanden)
  brandContext?: string; // MARKENKONTEXT-Faktenbasis aus dem Markenprofil (autoritativ)
  history?: string[]; // zuletzt generierte Hooks/Ideen — NIE wiederholen
  goal?: string; // Reichweite | Follower | Verkäufe | Community
  audience?: string; // optionale Zielgruppe
  topic?: string; // nur concept
  metrics?: TikTokMetrics; // nur diagnose
  /** Diagnose v2 — Worum geht es in deinem Video? (Thema/Beschreibung des
   *  analysierten Videos; OPTIONAL). Wird der Analyse als FAKTENQUELLE gegeben:
   *  Empfehlungen/neue Video-Version gehen dann konkret auf dieses Thema ein.
   *  Fehlt das Feld, darf das LLM KEIN Thema erfinden und sagt explizit, dass
   *  die Empfehlungen ohne Themenangabe allgemeiner bleiben. */
  videoTopic?: string;
  /** Diagnose v2 — Aktueller Hook/Titel des Videos (falls bekannt; OPTIONAL).
   *  Zusätzliche Faktenquelle für die Analyse; fehlt er, bleibt die Analyse
   *  auf Zahlen + videoTopic (falls vorhanden) gestützt. */
  videoHook?: string;
  /** Diversität (todayIdea): zuletzt verwendete Content-Richtung aus dem
   *  Richtungs-Katalog — wird bei der Auswahl ausgeschlossen, damit eine
   *  erneute Generierung eine ANDERE Richtung nimmt. Optional; fehlt der
   *  Parameter, wählt die Engine deterministisch (Katalog-Start) — Fallback
   *  ohne Client-Änderung. */
  previousDirection?: string;
  /** Phase 4 — Projekt-Kontext (lesend, optional): nur von todayIdea/concept
   *  genutzt; diagnose bleibt rein zahlenbasiert. */
  projectContext?: TikTokProjectContext;
}

/** Interner Qualitäts-Selbsttest (heute-Idee): ehrliche Antworten des Modells
 *  zu Markenfakten-Nutzung, Challenge-Berücksichtigung, Austauschbarkeit und
 *  Werblichkeit. Wird für den Verwerfen-&-Neu-generieren-Retry herangezogen. */
export interface TikTokSelfCheck {
  usesConcreteBrandFact: boolean; // nutzt mindestens eine konkrete Markenprofil-Info
  addressesCurrentChallenge: boolean; // hat eine vorhandene aktuelle Herausforderung berücksichtigt
  interchangeable: boolean; // könnte jede generische KI die Idee nahezu unverändert nutzen?
  soundsLikeAd: boolean; // klingt das Ergebnis wie Werbung?
  inventsUserOrTestimonial: boolean; // erfindet eine zitierte Person/Testimonial/Nutzerfeedback ohne Beleg im MARKENKONTEXT (HARD REJECT)
  unprovenPerformancePromise: boolean; // enthält ein unbelegtes konkretes Zeit-/Ergebnis-Leistungsversprechen ("in nur X Sekunden", "+X%", "verdoppelt die Reichweite", "viral gehen") ohne echte Daten (HARD REJECT)
  prescribedEnthusiasm: boolean; // verordnet eine künstliche Reaktion/Begeisterung ("Wow!", "😲", "da staunen alle", aufgesetzte Überraschung) ohne echten Bezug zum gezeigten tatsächlichen Ergebnis (HARD REJECT)
}

/** Interner Qualitäts-Selbsttest FÜR DIE DIAGNOSE (modus-spezifische Fragen):
 *  ehrliche Antworten des Modells zu erfundenen Kennzahlen, unbelegten
 *  Versprechen, vorgegebener Begeisterung, vager Test-Empfehlung und
 *  Zahlen-Bezug. Wird für den Verwerfen-&-Neu-generieren-Retry herangezogen. */
export interface TikTokDiagnoseSelfCheck {
  inventsMetrics: boolean; // erfindet Kennzahlen/Zahlen/Werte/Prozente, die der Nutzer NICHT angegeben hat (HARD REJECT)
  unprovenPromise: boolean; // unbelegtes konkretes Zeit-/Ergebnis-Versprechen in newHook/optimized/nextTest (HARD REJECT)
  prescribedEnthusiasm: boolean; // verordnete künstliche Reaktion/Begeisterung ("Wow!" etc.) (HARD REJECT)
  vagueNextTest: boolean; // nextTest ist vage/generisch statt EIN konkreter Test + zu beobachtende Metrik
  groundedInNumbers: boolean; // Aussagen sind tatsächlich an den gelieferten Zahlen belegt (false = generisch)
  lengthGrounded: boolean; // lengthRecommendation.reason begründet die Länge an den ECHTEN Nutzerzahlen (bzw. der deterministisch berechneten Retention) statt an einem generischen Default (false = verwerfen)
}

/** Einzelne zeitgestempelte Szene (Phase 2 — „Vollständiges Konzept"): was zu
 *  sehen ist und was in diesem Moment gesprochen bzw. eingeblendet wird. */
export interface TikTokTimedScene {
  time: string; // Zeitmarke, z.B. "0-2s", "2-6s"
  scene: string; // was passiert / zu sehen ist
  text: string; // gesprochener oder eingeblendeter Text (leer = kein Text)
}

/** Bild-/Videoidee (Phase 2): konkrete Idee + fertiger, ins Image-Studio
 *  übernehmbarer Prompt (studioPrompt). */
export interface TikTokImageIdea {
  description: string; // konkrete Bild-/Videoidee
  studioPrompt: string; // fertiger Image-Studio-Prompt (Subjekt, Stil, Licht, Komposition)
}

/** Ergebnis für todayIdea + concept (strukturiert, kein Roh-Chat). */
export interface TikTokIdeaResult {
  mode: 'todayIdea' | 'concept';
  idea: string; // konkrete Videoidee
  hook: string; // starker Hook (erste 1–2 Sekunden) + Texteinblendung
  length: string; // empfohlene Videolänge
  scenes: string[]; // Szenenablauf (Schritte)
  overlays: string[]; // Texteinblendungen
  spokenText: string; // optionaler Sprechtext
  caption: string;
  hashtags: string[]; // passende Hashtags
  cta: string;
  why: string; // kurze Erklärung, warum die Idee funktionieren könnte
  // ── Phase 2 — Vollständiges Konzept (optional im Typ → alte Outputs ohne die
  //    neuen Felder rendern weiterhin korrekt; der Parser nutzt Fallbacks).
  format?: string; // explizites Videoformat (z.B. "Tutorial/How-to") + kurze Begründung
  /** Phase 2 — Scroll-Stop-Moment: was in der ersten Sekunde konkret den Scroll
   *  stoppt (Auslöser + Begründung). Optional im Typ → alte Outputs ohne das
   *  Feld rendern weiterhin korrekt. */
  scrollStop?: string;
  /** Phase 2 — Spannungsbogen: wie Neugier/Spannung von Sekunde 0 bis zum
   *  Payoff aufgebaut und gehalten wird. Optional im Typ (s. scrollStop). */
  tension?: string;
  timedScenes?: TikTokTimedScene[]; // Szenenplan MIT Zeitangaben (Zeit + Szene + Text)
  title?: string; // eigenständiger TikTok-Titel (Suche/Profil-Anziehungskraft)
  imageIdeas?: TikTokImageIdea[]; // 2–4 konkrete Bild-/Videoideen mit studioPrompt
  selfCheck?: TikTokSelfCheck; // todayIdea + concept: Selbsttest-Flags (vom UI ungenutzt)
}

/** Diagnose v2 — Neue, direkt umsetzbare Video-Version: konkreter neuer
 *  Hook, lückenloser Szenenplan MIT Sekunden, Text/Voice-over, CTA und
 *  empfohlene Länge — alles passend zum eingegebenen Video-Thema. Optional im
 *  Typ → alte Diagnose-Outputs ohne das Feld rendern weiterhin korrekt. */
export interface TikTokRebuiltVersion {
  hook: string; // konkreter neuer Hook (erste 1–2 Sek., passend zum Thema)
  timedScenes: TikTokTimedScene[]; // Szenenplan mit Zeitmarken (lückenlos, 0s bis Ende)
  voiceover: string; // kompletter Text/Voice-over-Skript (natürlich formuliert)
  cta: string; // ein natürlicher Call-to-Action passend zum Thema
  seconds: number; // empfohlene Gesamtlänge in Sekunden (positiv)
}

/** Ergebnis für diagnose (volle Diagnose: alle Retentions-Pflichtfelder
 *  views + length + avgWatch sind angegeben). */
export interface TikTokDiagnoseResult {
  mode: 'diagnose';
  /** Phase 3 — ehrlicher „zu wenig Daten"-Zustand: true → stattdessen
   *  TikTokDiagnoseDataGapResult (keine geratene Länge, keine erfundenen
   *  Zahlen). Bei voller Diagnose ist dataGap immer undefined. */
  dataGap?: undefined;
  /** Diagnose v2 — Echo des eingegebenen Video-Themas (optional; fehlt bei
   *  alten Outputs/Nutzern ohne Themenangabe → UI-Rendering unverändert). */
  videoTopic?: string;
  /** Diagnose v2 — Neue, direkt umsetzbare Video-Version (Hook/Szenenplan mit
   *  Sekunden/Voice-over/CTA/Länge), konkret auf videoTopic/videoHook bezogen.
   *  Optional im Typ → alte Outputs ohne das Feld rendern weiterhin korrekt. */
  rebuilt?: TikTokRebuiltVersion;
  biggestProblem: string; // wahrscheinlich größtes Problem
  whatWorks: string[]; // was bereits funktioniert
  whatToImprove: string[]; // was verbessert werden sollte
  newHook: string; // neuer Hook
  optimized: string; // konkrete optimierte Video-Version
  nextTest: string; // Empfehlung für den nächsten Test
  /** Phase 3 — eigenständige Längen-/Aufbau-Empfehlung MIT Zahlenbegründung
   *  (optional im Typ → alte Outputs ohne das Feld rendern weiterhin korrekt;
   *  im Prompt als Pflicht gefordert, über selfCheck Q6 lengthGrounded
   *  abgesichert). */
  lengthRecommendation?: TikTokLengthRecommendation;
  selfCheck?: TikTokDiagnoseSelfCheck; // Selbsttest-Flags (vom UI ungenutzt)
}

/** Phase 3 — strukturierte Längen- & Aufbau-Empfehlung der Diagnose. */
export interface TikTokLengthRecommendation {
  seconds: number; // empfohlene Gesamtlänge in Sekunden (positiv)
  structure: string; // konkreter Aufbau für diese Länge MIT Zeitangaben: Hook-Phase (0–Xs), Inhalt, Call-to-Action
  reason: string; // Zahlenbegründung: referenziert NUR die Nutzerwerte + die deterministisch berechnete Retention (z. B. „Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge…")
}

/** Phase 3 — ehrlicher „zu wenig Daten"-Zustand: Statt zu raten (Länge ohne
 *  Retention wäre eine erfundene Zahl) liefert Growimo eine ehrliche Teil-
 *  Diagnose: was ohne die Daten NICHT beurteilt werden kann + welche Felder
 *  der Nutzer ergänzen soll. Deterministisch erzeugt — KEIN LLM-Call. */
export interface TikTokDiagnoseDataGapResult {
  mode: 'diagnose';
  dataGap: true; // Diskriminator: Teil-Diagnose statt voller Diagnose
  missingMetrics: TikTokRetentionMetricKey[]; // welche Pflicht-Metriken fehlen ('views' | 'length' | 'avgWatch')
  note: string; // ehrliche Erklärung, was ohne die Daten nicht beurteilt werden kann (de/en lokalisiert)
  cta: string; // genau welche Felder der Nutzer ergänzen soll
}

export type TikTokDiagnoseOutcome = TikTokDiagnoseResult | TikTokDiagnoseDataGapResult;

export type TikTokResult = TikTokIdeaResult | TikTokDiagnoseOutcome;

// ── Phase 3 — deterministische Retention-Rechnung (reine Funktion, kein LLM) ──
// Aus den vom Nutzer ANGEBERENEN Werten (views + length + avgWatch) wird eine
// Fakten-Basis für die Prompt-Begründung berechnet — NIE geschätzt/erfunden.
// avgWatch ist laut UI-Label die durchschnittliche Wiedergabedauer in SEKUNDEN.
/** Pflicht-Metriken der Diagnose (Retentions-Basis). */
export type TikTokRetentionMetricKey = 'views' | 'length' | 'avgWatch';

/** Ergebnis der deterministischen Retention-Rechnung (alles aus Nutzerwerten
 *  abgeleitet — nur reine Arithmetik, keine Schätzung). */
export interface TikTokRetentionInfo {
  views: number; // Aufrufe (Nutzerwert)
  avgWatchSeconds: number; // durchschnittliche Wiedergabedauer in Sekunden (Nutzerwert)
  lengthSeconds: number; // Videolänge in Sekunden (aus length-String geparst)
  watchRatePct: number; // avgWatch / length × 100 — Anteil der Videolänge, den Zuschauer im Schnitt sehen (1 Nachkommastelle)
  totalWatchSeconds: number; // views × avgWatch — gesamte Watch-Sekunden (reine Multiplikation der Nutzerwerte)
}

/** Parst eine Längenangabe in Sekunden: '42s', '42 Sekunden', '42 sec', '1:05',
 *  '0:42', '42'. Ungültig/nicht-positiv → undefined („nicht angegeben"). */
export function parseLengthSeconds(length: string | undefined): number | undefined {
  if (!length) return undefined;
  const s = String(length).trim().toLowerCase();
  if (!s) return undefined;
  // mm:ss / m:ss
  if (/^\d+:\d{1,2}$/.test(s)) {
    const [m, sec] = s.split(':').map(Number);
    const total = m * 60 + sec;
    return Number.isFinite(total) && total > 0 ? total : undefined;
  }
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** Deterministische Retention-Rechnung aus views + length + avgWatch.
 *  Division-durch-0-Guard: length muss > 0 sein (sonst null = nicht berechenbar).
 *  views=0 und avgWatch=0 sind ECHTE Werte (kein „fehlt") und werden korrekt
 *  durchgereicht (z. B. Watch-Rate 0, totale Watch-Sekunden 0). */
export function computeRetention(metrics: TikTokMetrics | undefined): TikTokRetentionInfo | null {
  if (!metrics) return null;
  if (metrics.views === undefined || !Number.isFinite(metrics.views)) return null;
  if (metrics.avgWatch === undefined || !Number.isFinite(metrics.avgWatch)) return null;
  if (metrics.avgWatch < 0) return null;
  const lengthSeconds = parseLengthSeconds(metrics.length);
  if (lengthSeconds === undefined || lengthSeconds <= 0) return null; // Division durch 0 vermeiden
  const watchRatePct = (metrics.avgWatch / lengthSeconds) * 100;
  return {
    views: metrics.views,
    avgWatchSeconds: metrics.avgWatch,
    lengthSeconds,
    watchRatePct: Math.round(watchRatePct * 10) / 10,
    totalWatchSeconds: metrics.views * metrics.avgWatch,
  };
}

/** Welche Retentions-Pflichtfelder fehlen (oder ungültig sind) → ehrlicher
 *  „zu wenig Daten"-Zustand statt raten. length gilt nur als angegeben, wenn
 *  sie sich zu einer positiven Sekundenzahl parsen lässt. */
export function diagnoseRetentionGaps(metrics: TikTokMetrics | undefined): TikTokRetentionMetricKey[] {
  if (!metrics) return ['views', 'length', 'avgWatch'];
  const missing: TikTokRetentionMetricKey[] = [];
  if (metrics.views === undefined || !Number.isFinite(metrics.views)) missing.push('views');
  if (parseLengthSeconds(metrics.length) === undefined) missing.push('length');
  if (metrics.avgWatch === undefined || !Number.isFinite(metrics.avgWatch)) missing.push('avgWatch');
  return missing;
}

// ── Prompts (de/en) ──────────────────────────────────────────────────────────
// Bewusst detailliert: Die Qualität der drei Modi hängt an klaren Feld- und
// Inhaltsvorgaben. Heute-Idee: Growimo wählt die Videoart SELBST (kein Rückfragen).
const IDEA_COMMON_EN = `You are Growimo's TikTok strategist — a veteran who knows exactly which short-form videos hook viewers in the first second and get pushed by the algorithm. Growimo DECIDES: do not ask the user what they want to make. Always deliver ONE concrete, complete, ready-to-record TikTok concept.

Rules:
- Answer ONLY with valid JSON, no other text, no markdown fences.
- Output must be in English.
- Be concrete, specific and practical. Never generic ("make a fun video" is forbidden). Every idea must be so concrete that the user could film it directly (specific scenes, what to show and say).
- Tie everything to the business/goal/audience provided. Never invent anything that is not in the business description: no features, offers, prices, or claims that do not follow from it.
- FACT CONTROL (hard rule): Use ONLY facts from the MARKENKONTEXT (or what the user explicitly provided). NEVER invent buttons, features, results, customers, downloads, views, likes, success stories, testimonials or any metric. If a piece of information is missing, develop an idea that works WITHOUT that claim instead of inventing details. Growimo must never claim anything that is not in the MARKENKONTEXT as a known fact. A PROJECT CONTEXT block (when provided) is an equally authoritative fact source for the selected project: use ONLY the fields it actually contains, never invent project facts, and never expand a Strategie-Brief field that is not present.
- PRIORITY OF THE USER'S OWN INPUT (HARD RULE): The "Topic" and "Business / product" entries in the user prompt ALWAYS outrank the MARKENKONTEXT. If the user names a different product, industry or subject than the brand (e.g. "small café", "jewelry", "Christmas pin"), THAT is the subject of the video — the MARKENKONTEXT then only supplies tone, brand voice and wording style and must NOT be applied to the user's subject. NEVER replace, override or reinterpret the user's subject into marketing for the brand's own product, and never quietly drop the user's subject.
- NO INVENTED PEOPLE / TESTIMONIALS / USER FEEDBACK (HARD RULE): It is FORBIDDEN to claim that any real person (user, customer, tester, beta user) said something, experienced something, or gave feedback about the product — UNLESS a real quote or proof actually appears in the MARKENKONTEXT or the user explicitly provided it. An example such as "a real user gives honest feedback on the beta" is UNACCEPTABLE because it is an invented testimonial. NEVER invent users, testers, ratings, reviews, experiences, results, revenue, reach or success stories. If NO real user/data exists, NEVER present it as real — instead develop authentic alternatives that show the creator's OWN honest process from the TARGET AUDIENCE\'s perspective (e.g. "I tried this approach for my own business — here is what happened", "How I get from one idea to a finished post in one afternoon"). Self-referential meta-topics that turn the own product/brand into the test object ("Can AI create a TikTok idea?", "We test our own product", "How good is my idea really?") are NOT an authentic alternative — they are interchangeable self-reference. This rule applies to the idea, the hook, the scenes, the overlays, the caption and the marketing strategy alike.
- BETA / EARLY-STAGE AUTHORIZED ALTERNATIVE (preferred): When the brand context describes a beta/startup in an early phase (markers such as "beta", "live", "few testers", "early phase") and there is NO real user feedback, PREFER a story that demonstrates a REAL feature / the REAL product and can be produced with REAL screen recordings of the actual app (the product may appear as a supporting element of the story — never as the topic). So instead of claiming that users/testimonials exist, the story shows the creator's OWN honest process / OWN experiment from the audience\'s perspective — the product is never the automatic topic of a daily idea.
- NO FAKE SCREENS / NON-EXISTENT FEATURES: Screenshots and on-screen overlays may show ONLY real, actually existing views. NEVER invent growth dashboards, fake ratings, or UI elements / feature names that do not exist. Scene descriptions may only show the real scope of the product — invent nothing that is not there.
- Angle selection (HARD priority order — FIRST search the TARGET AUDIENCE perspective for the most interesting TRUE content angle before you ever consider a product pitch): 1. a CONCRETE problem / genuine challenge of the target audience (what really occupies them?), 2. a surprising insight or a myth around the audience's topic, 3. a concrete tip or checklist that immediately helps the audience, 4. before/after or a small experiment the audience can follow, 5. storytelling from the audience's world, 6. todayIdea only: a CURRENT real challenge of the brand itself (only if the MARKENKONTEXT provides concrete material, e.g. "beta launched but barely any testers"), 7. behind-the-scenes of how the product/brand came to be, 8. a real demonstration of an actually existing feature (only if it fits the chosen direction naturally), 9. LAST RESORT: a classic product presentation — only if none of the above offers any usable material. Story, tension and curiosity OUTRANK product advertising in every case. If the MARKENKONTEXT contains a concrete, usable current-challenge fact (status/Herausforderung), it MUST be weighted strictly higher than a generic product demonstration: build a real story around that challenge instead of promoting the product.
- Do NOT repeat ideas/hooks from the provided "previously generated" list.
- Prefer AUTHENTIC TikTok formats: problem → attempt → result, behind-the-scenes, experiment, mistake/lesson, before/after, challenge, surprising insight, concrete demonstration, story. Story and curiosity take priority over advertising.
- The product must NOT be pitched immediately. It may appear ONLY if it fits naturally into the story/demo/experiment — never as the video's actual purpose.
- For simple concepts default to SHORT videos of about 8–20 seconds. Only go longer if the story genuinely justifies the extra content — set the length field accordingly.
- The hook MUST be a specific spoken + on-screen line for the first 1-2 seconds that stops the scroll. Hooks must be concrete to THIS business and must not be interchangeable/generic. Do not use empty teasers like "You won't believe…" unless a genuinely surprising payoff follows. The hook AND the first scene MUST show a concrete VISUAL element (object, action, detail or reveal) of THIS product — a general question alone (e.g. "Are you tired of …?") is NOT a scroll-stop and must not open the video.
- SCROLL-STOP MOMENT (MANDATORY FIELD "scrollStop"): name the EXACT trigger in the first second that stops the scroll (the concrete visual, object, gesture, question or line the viewer sees/hears) AND why it works for this audience — a generic justification ("because it is interesting") is NOT acceptable. You MUST pick exactly ONE mechanic from the mandatory catalog (Transformation, Reveal, unexpected result, Problem/Payoff, curiosity gap — or another equally concrete one) and NAME it at the start of the field, e.g. "Mechanic: Reveal — …". A spoken question without a visible element is NOT a valid scroll-stop.
- TENSION ARC (MANDATORY FIELD "tension"): describe how the video builds and holds curiosity from second 0 to the payoff (open loop → development/escalation → payoff) and name the second in which the payoff lands. Never leave the tension unexplained.
- SCENE PLAN WITH SECONDS (MANDATORY): timedScenes must be gap-free from 0s to the end of the video (e.g. "0-2s", "2-6s", "6-12s" …) and every step must name its seconds AND the on-screen/spoken text of that moment (empty string if nothing is shown or said).
- SPOKEN TEXT: fill "spokenText" whenever a spoken script/voice-over makes sense for the format (talking head, tutorial, story, demo) — leave it empty ONLY if the video genuinely works without words.
- NO unproven promises: "go viral", "become a hit", "guaranteed reach" and anything like that is forbidden.
- NO invented proof of success: no invented likes, comments, views, customers, testimonials, or any other success metrics.
- NO invented camera reactions / facial expressions: never write fake reactions into the scenes or overlays such as "creator looks surprised/proud/happy/impressed into the camera" UNLESS the actual action of the story genuinely produces them and the narrative truly supports them. A camera reaction may appear only if the story itself triggers it — never as a filler to fake emotion.
- NO UNPROVEN CONCRETE PERFORMANCE PROMISES (HARD RULE): NEVER make concrete, unverifiable performance or result promises — e.g. "in 10 seconds", "doubles your reach", "+500% engagement" — any concrete number or time frame promising guaranteed success is FORBIDDEN unless it is backed by real data the user actually provided. Concrete times as a promise ("in just 10 seconds", "in 2 minutes") are FORBIDDEN unless proven by real user data. Concrete growth/result promises (reach doubling, follower/click increases, success percentages) are FORBIDDEN unless backed by real data. Instead, use authentic curiosity and possibility WITHOUT false specifics — for example, INSTEAD OF "Can Growimo improve my TikTok idea in just 10 seconds?" say "I give Growimo a simple TikTok idea — let's see what comes out of it." This rule applies to the idea, the hook, the scenes, the spoken text, the overlays, the caption and the strategy alike.
- NO ARTIFICIAL REACTIONS / PRESCRIBED ENTHUSIASM (HARD RULE): Keep scenes authentic and show the actual result. FORBIDDEN as artificially demanded/prescribed reactions: "Wow!", "Whoa!", "I'm surprised", "in disbelief", "impressed", "excited", etc. Forbidden: prescribed enthusiasm or exaggerated emotion in scene descriptions, overlays or spoken text that is not genuinely produced by the actual action. No filler overlays/screen text such as "😲" or "everyone is amazed". A reaction may only arise genuinely from the shown actual result (naturally, not staged) — or be left out entirely.
- CTAs must be natural and interaction-focused (e.g. "What would you test?", "Tell us your take", "Share this with someone who…") — NOT "download/buy now" by default.
- Scenes: 3–6 concrete steps (what is shown/said at each moment).
- COMPLETE CONCEPT (MANDATORY FIELDS — every idea MUST contain ALL of them): format, timedScenes, title and imageIdeas are REQUIRED in every output:
  - format: exactly ONE concrete video format (choose from: Talking Head, Tutorial/How-to, Storytelling, Produkt-Showcase, Before/After, POV, Trend-Reaktion, FAQ/Quick-Tipps, Behind the Scenes — or another equally concrete one) plus a SHORT reason why this format serves the stated goal, e.g. "Tutorial/How-to – Schritt für Schritt (passt zum Ziel: Verkäufe)".
  - timedScenes: the complete scene plan WITH TIME MARKS covering the entire video from second 0 to its end. An array of objects {time, scene, text}: time is the exact time mark (e.g. "0-2s", "2-6s", "6-12s" — must cover the whole length without gaps), scene describes what is shown/happens, text is EXACTLY what is spoken or displayed as on-screen overlay in that moment (empty string if nothing). This is the shot-by-shot plan the user films directly.
  - title: a standalone TikTok title that stands ON ITS OWN next to the caption — catchy, concrete and appealing for profile/search (max ~60 characters, NOT identical to the hook).
  - imageIdeas: 2–4 concrete image/video ideas as objects {description, studioPrompt}. description names the concrete image/moment (e.g. "Produktfoto des Bechers in Morgenlicht"). studioPrompt is a COMPLETE, ready-to-paste Image Studio prompt (subject, style, lighting, composition — e.g. "Produktfoto, minimalistischer Stil, warmes Licht, Keramikbecher mit Dampf, Nahaufnahme, weicher Hintergrund") the user can drop straight into Growimo's Image Studio. If the video needs no separate images, still deliver 2–4 supporting image ideas (cover/thumbnail, props, scene mood, before/after).
- Text overlays (MANDATORY): 2–5 short on-screen text lines in natural wording — the texts the user really shows on screen.
- Caption (MANDATORY): ready to paste, written in the brand's natural voice.
- Hashtags: 3–5 relevant ones WITH # — NEVER more than 5 (anything above 5 is dropped automatically).
- CTA: one clear, realistic, natural call-to-action — but ONLY if it genuinely fits this video; if a CTA would feel forced, return an empty string (""). Never force "download/buy now" and never invent urgency.
- NO PLACEHOLDERS (HARD RULE): NEVER output generic placeholders such as "[insert trending sound here]", "Sound: <pick one>", "TODO", "your text here" or any bracketed instruction. For a sound/music/effect either give ONE concrete, justified recommendation (e.g. "quiet piano loop at ~70 BPM — the payoff lands on the beat") or OMIT that point completely. An output containing a placeholder is unusable: leave the point out instead of leaving a gap for the user to fill in.
- why: one short paragraph explaining why this idea can work for THIS goal.

Internal quality self-check BEFORE output (mandatory — answer honestly in the "selfCheck" field):
- Q1 - usesConcreteBrandFact: Does the idea use AT LEAST ONE concrete fact from the MARKENKONTEXT (more than just the generic business name)?
- Q2 - addressesCurrentChallenge: If the MARKENKONTEXT contains a present current challenge, did the idea genuinely account for it?
- Q3 - interchangeable: Could any generic AI tool produce this idea almost unchanged for 100 other businesses? Be strict: "show how easy it is to use our product" IS interchangeable and is a generic ad — reject it. Also report true if any FORBIDDEN generic line appears (e.g. "Find your style", "The difference is immediately visible", "Discover your potential", "The best for you") — such lines are interchangeable by definition.
- Q4 - soundsLikeAd: Does the result read like an advertisement?
- Q5 - inventsUserOrTestimonial: Does the idea claim that a real person (user, customer, tester, beta user) said/experienced/gave feedback about the product WITHOUT a real quote or proof in the MARKENKONTEXT (or provided by the user)? An invented user/testimonial/quote/user-feedback that is not backed by the MARKENKONTEXT MUST be reported as true. This is a HARD REJECT: if true, the idea is fabricated and MUST be discarded and regenerated — never output it.
- Q6 - unprovenPerformancePromise: Does the idea contain ANY unproven concrete time-based / result-based performance promise — e.g. "in just X seconds/minutes/days/weeks", "+X%", "% more reach/engagement/followers/clicks/sales/success", "doubles (the) reach/followers/clicks", "guaranteed more reach/followers/success", "go viral", "become a hit" — across the idea, the hook, the scenes, the overlays, the spoken text, the caption AND the why? Any such unproven concrete promise that is not backed by real data the user actually provided MUST be reported as true. This is a HARD REJECT: if true, the idea MUST be discarded and regenerated — never output it.
- Q7 - prescribedEnthusiasm: Does the idea prescribe an artificial reaction or required enthusiasm — e.g. "Wow!", "Whoa!", "everyone is amazed" / "da staunen alle", "I am/was surprised", "looks surprised/proud/happy/excited into the camera", staged surprise used as filler? A reaction may appear ONLY if it is genuinely produced by the shown real result; otherwise it is filler and MUST be reported as true. This is a HARD REJECT: if true, the idea MUST be discarded and regenerated — never output it.
Also verify BEFORE output: the idea contains NO unproven concrete performance promise (no "in just 10 seconds", no "doubles your reach", no success percentages not backed by real data, no "go viral") and NO prescribed artificial reaction/enthusiasm (no demanded "Wow!", "everyone is amazed", no staged surprise) unless it genuinely follows from the real shown result — both are HARD RULES and either one MUST be reported truthfully in Q6/Q7 and discarded and regenerated. Then set the seven selfCheck booleans truthfully. Then judge: if Q5, Q6 or Q7 is true, or Q3 or Q4 is true (or at least 3 of the 5 qualitative criteria are suspicious — e.g. no brand fact used, a challenge was ignored, interchangeable, ad-like), then internally DISCARD this idea and REGENERATE a different, better idea before outputting. Retry internally as many times as needed until the idea genuinely passes: it uses real brand facts, honors a present challenge, is NOT interchangeable, is NOT a straight ad, does NOT invent any user/testimonial/quote, contains NO unproven concrete performance promise and NO prescribed artificial reaction/enthusiasm.
- FACT CHECK: Does every specific claim (feature, button, number, result, customer, metric) actually appear in the MARKENKONTEXT or was it provided by the user? If anything is missing or not provable — remove or replace it with an idea that does not depend on that claim BEFORE outputting. Never invent facts.

JSON schema exactly:
{
  "idea": "one-sentence concrete video idea / concept",
  "hook": "exact first 1-2 second hook line (spoken + written)",
  "scrollStop": "the exact trigger in the first second that stops the scroll, starting with \"Mechanic: <name> — \" (name the chosen mechanic from the catalog) + why it works for this audience",
  "tension": "tension arc: how curiosity is built and held from second 0 to the payoff (open loop -> development -> payoff, incl. the second of the payoff)",
  "length": "recommended length, e.g. '45 seconds'",
  "format": "one concrete video format + short reason, e.g. 'Tutorial/How-to – step by step (fits the goal: sales)'",
  "title": "standalone TikTok title (max ~60 characters)",
  "timedScenes": [{"time": "0-2s", "scene": "what is shown/happens", "text": "spoken or on-screen text (empty string if none)"}, {"time": "2-6s", "scene": "…", "text": "…"}],
  "scenes": ["step 1...", "step 2...", "step 3..."],
  "overlays": ["on-screen text 1", "on-screen text 2"],
  "spokenText": "optional spoken script (or empty string)",
  "caption": "ready-to-paste caption",
  "hashtags": ["#tag1", "#tag2"],
  "cta": "one clear call-to-action",
  "why": "why this idea can work for this goal",
  "imageIdeas": [{"description": "concrete image/video idea", "studioPrompt": "complete Image Studio prompt (subject, style, lighting, composition)"}],
  "selfCheck": {
    "usesConcreteBrandFact": true or false,
    "addressesCurrentChallenge": true or false,
    "interchangeable": true or false,
    "soundsLikeAd": true or false,
    "inventsUserOrTestimonial": true or false,
    "unprovenPerformancePromise": true or false,
    "prescribedEnthusiasm": true or false
  }
}`;

const IDEA_COMMON_DE = `Du bist Growimos TikTok-Strateg: ein Veteran, der genau weiß, welche Kurzvideos in der ersten Sekunde haken und vom Algorithmus gepusht werden. Growimo ENTSCHEIDET: Frage den Nutzer NICHT, was er machen will. Liefere immer EIN konkretes, komplettes, aufnahmefähiges TikTok-Konzept.

Regeln:
- Antworte AUSSCHLIESSLICH mit validem JSON, kein anderer Text, keine Markdown-Fences.
- Ausgabe vollständig auf Deutsch.
- Sei konkret, spezifisch und praktisch. Niemals generisch („Mach ein lustiges Video" ist verboten). Jede Idee muss so konkret sein, dass der Nutzer sie direkt filmen kann (konkrete Szenen, was zu sehen/zu sagen ist).
- Alles auf Unternehmen/Ziel/Zielgruppe abstimmen. Erfinde nichts, was nicht in der Unternehmensbeschreibung steht: keine Funktionen, Angebote, Preise oder Behauptungen, die nicht daraus hervorgehen.
- FAKTENKONTROLLE (harte Regel): Verwende AUSSCHLIESSLICH Fakten aus dem MARKENKONTEXT (oder was der Nutzer explizit angegeben hat). Erfinde NIEMALS Buttons, Funktionen, Ergebnisse, Kunden, Downloads, Views, Likes, Erfolgsgeschichten, Testimonials oder irgendeine Metrik. Wenn eine Information fehlt, entwickle eine Idee, die OHNE diese Behauptung funktioniert, statt Details zu erfinden. Growimo darf nichts behaupten, was nicht als bekannte Tatsache im MARKENKONTEXT steht. Ein PROJEKT-KONTEXT-Block (falls vorhanden) ist eine ebenso autoritative Faktenquelle für das gewählte Projekt: verwende AUSSCHLIESSLICH die Felder, die er tatsächlich enthält, erfinde keine Projekt-Fakten und erweitere kein Strategie-Brief-Feld, das nicht vorhanden ist.
- VORRANG DER NUTZEREINGABE (harte Regel): Die Angaben „Thema" und „Unternehmen / Produkt" aus dem Nutzer-Prompt haben IMMER Vorrang vor dem MARKENKONTEXT. Nennt der Nutzer ein anderes Produkt, eine andere Branche oder ein anderes Thema als die Marke (z. B. „kleines Café", „Schmuck", „Weihnachts-Pin"), dann IST das der Gegenstand des Videos — der MARKENKONTEXT liefert dann nur noch Tonalität, Markenstimme und Formulierungsstil und darf NICHT auf das Nutzerthema angewendet werden. Ersetze, überschreibe oder interpretiere das Nutzerthema NIEMALS in Marketing für das eigene Produkt um und lasse das Nutzerthema niemals stillschweigend weg.
- KEINE ERFUNDENEN PERSONEN / TESTIMONIALS / NUTZERFEEDBACK (harte Regel): Es ist VERBOTEN zu behaupten, dass eine echte Person (Nutzer, Kunde, Tester, Beta-Nutzer) etwas über das Produkt gesagt/erlebt/Feedback gegeben hat, SOLANGE kein echtes Zitat oder Beleg im MARKENKONTEXT steht oder der Nutzer es explizit angegeben hat. Ein Beispiel wie „Eine echte Nutzerin gibt ehrliches Feedback zur Beta" ist UNZULÄSSIG, weil es ein erfundenes Testimonial darstellt. Erfinde NIEMALS Nutzer, Tester, Bewertungen, Rezensionen, Erfahrungen, Ergebnisse, Umsätze, Reichweiten oder Erfolgsgeschichten. Liegen KEINE echten Nutzerdaten vor, dürfen diese NIEMALS als real dargestellt werden — entwickle stattdessen authentische Alternativen, die den EIGENEN ehrlichen Prozess aus der PERSPEKTIVE DER ZIELGRUPPE zeigen (z. B. „Ich habe diesen Ansatz für mein Business ausprobiert — das kam dabei heraus", „So komme ich an einem Nachmittag von einer Idee zu einem fertigen Post"). Selbstreferenzielle Meta-Themen, die das eigene Produkt/die eigene Marke zum Testobjekt machen („Kann eine KI eine TikTok-Idee erstellen?", „Wir testen unser eigenes Produkt", „Wie gut ist meine TikTok-Idee wirklich?"), sind KEINE authentische Alternative — sie sind austauschbare Selbstreferenz. Diese Regel gilt gleichermaßen für Idee, Hook, Szenen, Einblendungen, Caption und Marketing-Strategie.
- BETA-/FRÜHPHASEN-ALTERNATIVE (autorisiert, bevorzugt): Wenn der Markenkontext ein Beta-/Startup-Projekt in früher Phase beschreibt (Marker wie „Beta", „live", „kaum Tester", „frühe Phase") und KEIN echtes Nutzerfeedback vorliegt, ziehe BEVORZUGT eine Story vor, die eine echte Funktion / das echte Produkt demonstriert und mit realen Bildschirmaufnahmen der tatsächlichen App umgesetzt werden kann (das Produkt darf als Beiwerk der Story vorkommen — niemals als ihr Thema). Statt also zu behaupten, dass Nutzer/Testimonials existieren, zeigt die Story den EIGENEN ehrlichen Prozess / das EIGENE Experiment des Creators aus der Zielgruppen-Perspektive — das Produkt ist niemals das automatische Thema einer heutigen Idee.
- KEINE FAKE-SCREENS / NICHT VORHANDENE FUNKTIONEN: Screenshots und Einblendungen dürfen NUR echte, tatsächlich existierende Ansichten zeigen. Erfinde niemals Wachstums-Dashboards, Fake-Bewertungen oder UI-Elemente/Funktionsnamen, die es nicht gibt. Szenenbeschreibungen dürfen nur den echten Produktumfang zeigen — erfinde nichts, das nicht existiert.
- Winkel-Wahl (HARTE Prioritätsreihenfolge — durchsuche zuerst die ZIELGRUPPEN-PERSPEKTIVE nach dem interessantesten ECHTEN Content-Winkel, BEVOR du überhaupt eine Produktwerbung in Betracht ziehst): 1. ein KONKRETES Problem / eine echte Herausforderung der ZIELGRUPPE (was beschäftigt sie wirklich?), 2. eine überraschende Erkenntnis oder ein Mythos rund um das Thema der Zielgruppe, 3. ein konkreter Tipp oder eine Checkliste, die der Zielgruppe sofort hilft, 4. Vorher/Nachher oder ein kleines Experiment, das die Zielgruppe nachvollziehen kann, 5. Storytelling aus dem Umfeld der Zielgruppe, 6. NUR bei todayIdea: eine AKTUELLE echte Herausforderung der Marke selbst (nur wenn der MARKENKONTEXT konkretes Material liefert, z. B. „Beta gestartet, aber kaum Tester"), 7. Behind the Scenes der Entstehung von Produkt/Marke, 8. eine echte Demonstration einer tatsächlich vorhandenen Funktion (nur wenn sie in die gewählte Richtung natürlich passt), 9. ERST ZULETZT: klassische Produktvorstellung — nur wenn keiner der vorigen Punkte verwertbares Material bietet. Story, Spannung und Neugier haben in jedem Fall Vorrang vor Produktwerbung. Wenn der MARKENKONTEXT eine konkrete, verwertbare aktuelle Herausforderung enthält (Status/Herausforderung), MUSS diese bei todayIdea GRUNDSÄTZLICH stärker gewichtet werden als eine generische Produktdemonstration: baue eine echte Story um diese Herausforderung, statt das Produkt zu bewerben.
- Wiederhole KEINE Ideen/Hooks aus der übergebenen Liste „zuvor generiert".
- Bevorzuge AUTHENTISCHE TikTok-Formate: Problem → Versuch → Ergebnis, Behind-the-Scenes, Experiment, Fehler/Learning, Vorher/Nachher, Challenge, überraschende Erkenntnis, konkrete Demonstration, Story. Story und Neugier haben Vorrang vor Werbung.
- Das Produkt darf NICHT sofort beworben werden. Es darf NUR auftauchen, wenn es natürlich in die Story/Demo/Experiment passt — nicht als eigentlicher Zweck des Videos.
- Für einfache Konzepte standardmäßig KURZE Videos von ca. 8–20 Sekunden. Länger NUR, wenn die Story den zusätzlichen Inhalt wirklich rechtfertigt — setze das length-Feld entsprechend.
- Der Hook MUSS eine konkrete gesprochene + eingeblendete Zeile für die ersten 1–2 Sekunden sein, die den Scroll stoppt. Hooks müssen konkret zu DIESEM Unternehmen passen und dürfen nicht austauschbar/generisch sein. Nutze keine leeren Teaser wie „Du glaubst nicht…", außer eine echte überraschende Auflösung folgt. Der Hook UND die erste Szene MÜSSEN ein KONKRETES visuelles Element DIESES Produkts zeigen (Objekt, Handlung, Detail oder Reveal) — eine allgemeine Frage allein (z. B. „Bist du es leid, dass …?") ist KEIN Scroll-Stop und darf das Video nicht eröffnen.
- SCROLL-STOP-MOMENT (PFLICHTFELD „scrollStop"): Benenne den EXAKTEN Auslöser in der ersten Sekunde, der den Scroll stoppt (das konkrete Bild, Objekt, die Geste, Frage oder Zeile, die der Zuschauer sieht/hört) UND warum er bei DIESER Zielgruppe wirkt — eine generische Begründung („weil es interessant ist") ist NICHT akzeptabel. Du MUSST GENAU EINE Mechanik aus dem Pflicht-Katalog (Transformation, Reveal, unerwartetes Ergebnis, Problem/Payoff, Neugierlücke — oder eine andere ebenso konkrete) wählen und sie am Anfang des Feldes BENENNEN, z. B. „Mechanik: Reveal — …". Eine gesprochene Frage ohne sichtbares Element ist KEIN gültiger Scroll-Stop.
- SPANNUNGSBOGEN (PFLICHTFELD „tension"): Beschreibe, wie das Video von Sekunde 0 bis zum Payoff Neugier/Spannung aufbaut und hält (offene Schleife → Entwicklung/Steigerung → Payoff) und in welcher Sekunde der Payoff liegt. Lass die Spannung niemals unerklärt.
- SZENENPLAN MIT SEKUNDEN (PFLICHT): timedScenes müssen von 0s bis zum Videoende LÜCKENLOS sein (z. B. „0-2s", „2-6s", „6-12s" …) und jeder Schritt muss seine Sekunden UND den Text dieses Moments nennen (leere Zeichenkette, wenn nichts gezeigt/gesagt wird).
- SPRECHTEXT: Fülle „spokenText" immer dann, wenn ein Sprech-/Voice-over-Skript für das Format sinnvoll ist (Talking Head, Tutorial, Story, Demo) — leer NUR, wenn das Video wirklich ohne Worte funktioniert.
- KEINE unbelegten Versprechen: „viral gehen", „zum Hit werden", „garantiert mehr Reichweite" und dergleichen ist verboten.
- KEINE erfundenen Erfolgsnachweise: keine erfundenen Likes, Kommentare, Views, Kunden, Testimonials oder sonstigen Erfolgskennzahlen.
- KEINE erfundenen Kamerareaktionen/Gesichtsausdrücke: schreibe niemals Fake-Reaktionen in die Szenen oder Einblendungen wie „der Ersteller schaut überrascht/stolz/glücklich/beeindruckt in die Kamera", AUSSER die tatsächliche Handlung der Story erzeugt sie echt und die Erzählung trägt sie wirklich. Eine Kamerareaktion darf nur auftauchen, wenn die Story sie selbst auslöst — niemals als Füllmittel, um Emotionen vorzutäuschen.
- KEINE unbelegten konkreten Leistungsversprechen (harte Regel): Mache NIEMALS konkrete, unbelegte Leistungs-/Ergebnis-Versprechen, z. B. „in 10 Sekunden", „verdoppelt deine Reichweite", „+500% Engagement" — jede konkrete Zahl oder Zeitangabe, die garantierten Erfolg verspricht, ist VERBOTEN, außer sie ist durch echte, vom Nutzer bereitgestellte Daten belegt. Konkrete Zeitangaben als Versprechen („in nur 10 Sekunden", „in 2 Minuten") sind VERBOTEN, wenn sie nicht durch echte Nutzerdaten belegt sind. Konkrete Wachstums-/Ergebnis-Versprechen (Reichweiten-Verdopplung, Follower-/Klicksteigerung, Erfolgsprozente) sind VERBOTEN, wenn sie nicht durch echte Daten belegt sind. Stattdessen: authentische Neugier/Möglichkeit ohne falsche Konkretisierung — z. B. STATT „Kann Growimo meine TikTok-Idee in nur 10 Sekunden verbessern?" besser „Ich gebe Growimo eine einfache TikTok-Idee – mal sehen, was daraus wird." Diese Regel gilt gleichermaßen für Idee, Hook, Szenen, Sprechtext, Einblendungen, Caption und Strategie.
- KEINE künstlichen Reaktionen / vorgegebene Begeisterung (harte Regel): Szenen sollen authentisch bleiben und das tatsächliche Ergebnis zeigen. VERBOTEN sind als künstlich verlangte/vorgegebene Reaktionen „Wow!", „Whoa!", „ich bin überrascht", „ungläubig", „beeindruckt", „begeistert" usw. Verboten: vorgegebene Begeisterung/übertriebene Emotionen in Szenenbeschreibungen, Einblendungen oder Sprechtext, die nicht durch die tatsächliche Handlung echt erzeugt werden. Keine Einblendungs-/Screen-Texte wie „😲" oder „Da staunen alle" als Füllmaterial. Eine Reaktion darf sich nur ECHT aus dem gezeigten tatsächlichen Ergebnis ergeben (natürlich, nicht aufgesetzt) — oder ganz weggelassen werden.
- CTAs natürlich und Interaktion fördernd (z. B. „Was würdest du testen?", „Schreib deine Meinung dazu", „Teil das mit jemandem, der…") — NICHT standardmäßig „Jetzt herunterladen/kaufen".
- Szenen: 3–6 konkrete Schritte (was in jedem Moment gezeigt/gesagt wird).
- KOMPLETTES KONZEPT (PFLICHTFELDER — jede Idee MUSS alle enthalten): format, timedScenes, title und imageIdeas sind in JEDER Ausgabe PFLICHT:
  - format: GENAU EIN konkretes Videoformat (wähle aus: Talking Head, Tutorial/How-to, Storytelling, Produkt-Showcase, Before/After, POV, Trend-Reaktion, FAQ/Quick-Tipps, Behind the Scenes — oder ein anderes ebenso konkretes) plus eine KURZE Begründung, warum dieses Format das genannte Ziel bedient, z. B. „Tutorial/How-to – Schritt für Schritt (passt zum Ziel: Verkäufe)".
  - timedScenes: der komplette Szenenplan MIT ZEITANGABEN, der das gesamte Video von Sekunde 0 bis zum Ende abdeckt. Ein Array aus Objekten {time, scene, text}: time ist die exakte Zeitmarke (z. B. „0-2s", „2-6s", „6-12s" — muss die ganze Länge lückenlos abdecken), scene beschreibt, was zu sehen ist/passiert, text ist EXAKT das, was in diesem Moment gesprochen oder als Einblendung angezeigt wird (leere Zeichenkette, wenn nichts). Das ist der Shot-für-Shot-Plan, den der Nutzer direkt abfilmen kann.
  - title: ein eigenständiger TikTok-Titel, der allein neben der Caption steht — einprägsam, konkret, anziehend für Profil/Suche (max. ~60 Zeichen, NICHT identisch mit dem Hook).
  - imageIdeas: 2–4 konkrete Bild-/Videoideen als Objekte {description, studioPrompt}. description benennt das konkrete Bild/den Moment (z. B. „Produktfoto des Bechers im Morgenlicht"). studioPrompt ist ein KOMPLETTER, direkt ins Image-Studio übernehmbarer Prompt (Subjekt, Stil, Licht, Komposition — z. B. „Produktfoto, minimalistischer Stil, warmes Licht, Keramikbecher mit Dampf, Nahaufnahme, weicher Hintergrund"), den der Nutzer direkt in Growimos Image-Studio einfügen kann. Wenn das Video keine separaten Bilder braucht, liefere trotzdem 2–4 unterstützende Bildideen (Cover/Thumbnail, Requisiten, Szene-Stimmung, Vorher/Nachher).
- Texteinblendungen (PFLICHT): 2–5 kurze Bildschirmtextzeilen in natürlicher Formulierung — die Texte, die der Nutzer wirklich einblendet.
- Caption (PFLICHT): kopierfertig, in der natürlichen Stimme der Marke.
- Hashtags: 3–5 relevante MIT # — NIEMALS mehr als 5 (alles darüber wird automatisch entfernt).
- CTA: ein klarer, realistischer, natürlicher Call-to-Action — aber NUR, wenn er wirklich zu diesem Video passt; würde ein CTA aufgesetzt wirken, gib eine leere Zeichenkette ("") zurück. Erzwinge niemals „Jetzt herunterladen/kaufen" und erfinde keinen Druck.
- KEINE PLATZHALTER (harte Regel): Gib NIEMALS generische Platzhalter aus wie „[Trendigen Sound hier einfügen]", „Sound: <beliebig wählen>", „TODO", „dein Text hier" oder irgendeine eckige Klammer-Anweisung. Für Sound/Musik/Effekt gilt: entweder EINE konkrete, begründete Empfehlung (z. B. „leiser Klavier-Loop mit ca. 70 BPM — der Payoff landet auf dem Takt") oder den Punkt KOMPLETT weglassen. Eine Ausgabe mit Platzhalter ist unbrauchbar: lieber den Punkt weglassen als eine Lücke zum Ausfüllen hinterlassen.
- why: ein kurzer Absatz, warum diese Idee für DIESES Ziel funktionieren kann.

Interne Qualitäts-Selbstprüfung VOR der Ausgabe (Pflicht — beantworte ehrlich im Feld „selfCheck"):
- Q1 - usesConcreteBrandFact: Nutzt die Idee MINDESTENS eine konkrete Information aus dem MARKENKONTEXT (mehr als nur den generischen Markennamen)?
- Q2 - addressesCurrentChallenge: Wenn der MARKENKONTEXT eine aktuelle Herausforderung enthält, hat die Idee sie wirklich berücksichtigt?
- Q3 - interchangeable: Könnte irgendeine generische KI diese Idee nahezu unverändert für 100 andere Unternehmen erzeugen? Sei streng: „Zeig, wie einfach unser Produkt zu nutzen ist" IST austauschbar und generische Werbung — verwerfe es. Melde außerdem true, wenn ein VERBOTENER generischer Satz vorkommt (z. B. „Finde deinen Stil", „Der Unterschied ist sofort sichtbar", „Entdecke dein Potenzial", „Das Beste für dich") — solche Sätze sind per Definition austauschbar.
- Q4 - soundsLikeAd: Klingt das Ergebnis wie Werbung?
- Q5 - inventsUserOrTestimonial: Behauptet die Idee, dass eine echte Person (Nutzer, Kunde, Tester, Beta-Nutzer) etwas über das Produkt gesagt/erlebt/Feedback gegeben hat, OHNE echtes Zitat oder Beleg im MARKENKONTEXT (oder vom Nutzer angegeben)? Ein erfundenes Testimonial/erfundene zitierte Person/erfundenes Nutzerfeedback, das nicht durch den MARKENKONTEXT belegt ist, MUSS als true gemeldet werden. Das ist ein HARD REJECT: Ist das Flag true, ist die Idee erfunden und MUSS verworfen und NEU generiert werden — niemals ausgeben.
- Q6 - unprovenPerformancePromise: Enthält die Idee IRGENDEIN unbelegtes konkretes Zeit-/Ergebnis-Leistungsversprechen — z. B. „in nur X Sekunden/Minuten/Tagen/Wochen", „+X%", „% mehr Reichweite/Engagement/Follower/Klicks/Verkäufe/Erfolg", „verdoppelt (die) Reichweite/Follower/Klicks", „garantiert mehr Reichweite/Follower/Erfolg", „viral gehen", „zum Hit werden" — in Idee, Hook, Szenen, Einblendungen, Sprechtext, Caption UND why? Jedes solche unbelegte konkrete Versprechen, das nicht durch echte, vom Nutzer gelieferte Daten belegt ist, MUSS als true gemeldet werden. Das ist ein HARD REJECT: Ist das Flag true, MUSS die Idee verworfen und NEU generiert werden — niemals ausgeben.
- Q7 - prescribedEnthusiasm: Verordnet die Idee eine künstliche Reaktion oder verlangte Begeisterung — z. B. „Wow!", „Whoa!", „Da staunen alle", „ich bin/war überrascht", „sieht überrascht/stolz/froh/begeistert in die Kamera", aufgesetzte Überraschung als Füllmaterial? Eine Reaktion darf NUR auftauchen, wenn sie das gezeigte tatsächliche Ergebnis echt erzeugt; sonst ist sie Füllmaterial und MUSS als true gemeldet werden. Das ist ein HARD REJECT: Ist das Flag true, MUSS die Idee verworfen und NEU generiert werden — niemals ausgeben.
Prüfe außerdem VOR der Ausgabe: Die Idee enthält KEIN unbelegtes konkretes Leistungsversprechen (kein „in nur 10 Sekunden", kein „verdoppelt deine Reichweite", keine Erfolgsprozente, kein „viral gehen", die nicht durch echte Daten belegt sind) und KEINE vorgegebene künstliche Reaktion/Begeisterung (kein verlangtes „Wow!", „Da staunen alle", keine aufgesetzte Überraschung), außer sie ergibt sich echt aus dem gezeigten tatsächlichen Ergebnis — beides sind HARTE REGELN und jede davon MUSS wahrheitsgemäß in Q6/Q7 gemeldet und verworfen und NEU generiert werden. Setze dann die sieben selfCheck-Booleans wahrheitsgemäß. Dann urteile: Wenn Q5, Q6 oder Q7 wahr ist, oder Q3 oder Q4 wahr ist (oder mindestens 3 der 5 qualitativen Kriterien verdächtig sind — z. B. keine Markenfakten genutzt, eine Herausforderung ignoriert, austauschbar, werblich), dann VERWIRF diese Idee intern und generiere eine andere, bessere Idee NEU, BEVOR du ausgibst. Wiederhole intern so oft wie nötig, bis die Idee wirklich besteht: sie nutzt echte Markenfakten, ehrt eine vorhandene Herausforderung, ist NICHT austauschbar, ist KEINE reine Werbung, erfindet KEINE Nutzer/Testimonials/Zitate, enthält KEIN unbelegtes konkretes Leistungsversprechen und KEINE vorgegebene künstliche Reaktion/Begeisterung.
- FAKTENABGLEICH: Steht jede konkrete Behauptung (Funktion, Button, Zahl, Ergebnis, Kunde, Metrik) tatsächlich im MARKENKONTEXT oder hat der Nutzer sie angegeben? Wenn etwas fehlt oder nicht belegbar ist — entferne oder ersetze es durch eine Idee, die ohne diese Behauptung funktioniert, BEVOR du ausgibst. Erfinde niemals Fakten.

JSON-Schema exakt:
{
  "idea": "ein Satz: konkrete Videoidee/Konzept",
  "hook": "exakte Hook-Zeile für die ersten 1-2 Sekunden (gesprochen + eingeblendet)",
  "scrollStop": "der exakte Auslöser in der ersten Sekunde, der den Scroll stoppt, beginnend mit „Mechanik: <Name> — " (gewählte Mechanik aus dem Katalog benennen) + warum er bei dieser Zielgruppe wirkt",
  "tension": "Spannungsbogen: wie Neugier von Sekunde 0 bis zum Payoff aufgebaut und gehalten wird (offene Schleife -> Entwicklung -> Payoff, inkl. Sekunde des Payoffs)",
  "length": "empfohlene Länge, z.B. '15 Sekunden'",
  "format": "ein konkretes Videoformat + kurze Begründung, z.B. 'Tutorial/How-to – Schritt für Schritt (passt zum Ziel: Verkäufe)'",
  "title": "eigenständiger TikTok-Titel (max. ~60 Zeichen)",
  "timedScenes": [{"time": "0-2s", "scene": "was zu sehen ist/passiert", "text": "gesprochener oder eingeblendeter Text (leer, wenn keiner)"}, {"time": "2-6s", "scene": "…", "text": "…"}],
  "scenes": ["Schritt 1...", "Schritt 2...", "Schritt 3..."],
  "overlays": ["Texteinblendung 1", "Texteinblendung 2"],
  "spokenText": "optionaler Sprechtext (auch leere Zeichenkette möglich)",
  "caption": "kopierfertige Caption",
  "hashtags": ["#Tag1", "#Tag2"],
  "cta": "ein klarer Call-to-Action",
  "why": "warum diese Idee für dieses Ziel funktionieren kann",
  "imageIdeas": [{"description": "konkrete Bild-/Videoidee", "studioPrompt": "kompletter Image-Studio-Prompt (Subjekt, Stil, Licht, Komposition)"}],
  "selfCheck": {
    "usesConcreteBrandFact": true oder false,
    "addressesCurrentChallenge": true oder false,
    "interchangeable": true oder false,
    "soundsLikeAd": true oder false,
    "inventsUserOrTestimonial": true oder false,
    "unprovenPerformancePromise": true oder false,
    "prescribedEnthusiasm": true oder false
  }
}`;

// ── Phase 2 (C8) — gemeinsames Qualitäts-Mandat: todayIdea == concept ────────
// Diese vier Regeln standen bis Phase 2 ausschließlich im todayIdea-Prompt und
// fehlten dem concept-Pfad komplett. Sie sind jetzt EINE Quelle (geteilt statt
// dupliziert) und werden von BEIDEN Idee-Modi verwendet:
//   (1) Zielgruppen-Perspektive als Pflicht,
//   (2) Produkt höchstens Beiwerk — NICHT das Thema,
//   (3) Selbstreferenz-Verbot (produktzentrierte Meta-Ideen),
//   (4) Anti-Werbe-/Aufmerksamkeits-Mandat (Mensch zuerst, Verkaufen danach).
// Das Label des Selbstreferenz-Verbots wird übergeben, damit der todayIdea-Prompt
// seine etablierte Formulierung ("… (heute-Idee)" / "(daily idea)") behält.
function ideaQualityMandate(de: boolean, selfRefLabel: string): string {
  if (de) {
    return `QUALITÄTS-MANDAT (VERBINDLICH — exakt derselbe Standard wie im Modus „Was soll ich heute posten?"):
- ZIELGRUPPEN-PERSPEKTIVE (harte Regel): Baue die gesamte Idee aus der PERSPEKTIVE DER ZIELGRUPPE auf (was hilft, interessiert oder begeistert SIE?) — NICHT aus der Produktperspektive und NICHT aus der Perspektive des Markeninhabers.
- PRODUKT IST NICHT DAS THEMA (harte Regel): Das Produkt/Unternehmen darf höchstens als Beiwerk, Beispiel oder Umsetzungs-Hilfe INNERHALB der Story vorkommen — niemals als Thema oder Zweck des Videos.
- ${selfRefLabel}: VERBOTEN sind selbstreferenzielle Meta-Ideen, die die eigene Marke/das eigene Produkt zum Testobjekt machen, z. B. „Kann Growimo eine TikTok-Idee erstellen?", „Wir testen unser eigenes Produkt", „Wie gut ist meine TikTok-Idee wirklich?", „Kann eine KI eine Strategie verbessern?". Solche Ideen sind austauschbare Selbstreferenz und gelten als werblich → setze Q3/Q4 im selfCheck auf true (verwerfen und NEU generieren). Ausnahme: Wenn der MARKENKONTEXT eine konkrete, verwertbare AKTUELLE Herausforderung enthält (z. B. „Beta gestartet, aber kaum Tester"), darfst du die Idee um diese ehrliche Situation bauen — die Story zählt dann, nicht das Produkt.
- ANTI-WERBE-MANDAT (Mensch zuerst): Greife NICHT zur Standard-Werbe-Struktur — genau das gilt es zu vermeiden. Aufmerksamkeit und Zuschauerbindung kommen ZUERST, Verkaufen danach: beginne mit dem menschlichen Moment, der Neugier, der Story, der Demonstration oder dem Experiment aus der Zielgruppen-Perspektive, schaffe Vertrauen und Interesse, und bringe das Produkt höchstens am Ende als Beiwerk ein — oder gar nicht — wenn es natürlich passt. Erst Aufmerksamkeit & Bindung, dann Verkauf.`;
  }
  return `QUALITY MANDATE (MANDATORY — exactly the same standard as Growimo's "What should I post today?" mode):
- TARGET-AUDIENCE PERSPECTIVE (hard rule): build the whole idea from the TARGET AUDIENCE's perspective (what helps, interests or excites THEM?) — NOT from the product perspective and NOT from the perspective of the brand owner.
- PRODUCT IS NOT THE TOPIC (hard rule): the product/business may appear at most as a supporting element, example or implementation aid WITHIN the story — never as the topic or the purpose of the video.
- ${selfRefLabel}: self-referential meta-ideas that turn your own brand/product into the test object are FORBIDDEN, e.g. "Can Growimo create a TikTok idea?", "We test our own product", "How good is my TikTok idea really?", "Can AI improve a strategy?". Such ideas are interchangeable self-reference and count as ad-like → set Q3/Q4 in selfCheck to true (discard and regenerate). Exception: if the BRAND CONTEXT contains a concrete, usable CURRENT CHALLENGE (e.g. "launched the beta, but hardly anyone tests it"), you may build the idea around that honest situation — the story counts, not the product.
- ANTI-AD MANDATE (human first): do NOT default to the classic ad structure — that is exactly what to avoid. ATTENTION and VIEWER RETENTION come first, selling second: open with the human moment, the curiosity, the story, the demonstration or the experiment from the audience's perspective, build trust and interest, and bring the product in only at the end as a supporting element — or not at all — if it fits naturally. Serve attention & connection first, selling second.`;
}

// ── Phase 5g (Owner-Auftrag 2026-09-23) — VERSCHÄRFTES INHALTS-MANDAT ───────
// Test C war NICHT bestanden: die Ideen deuteten die Nutzereingabe um
// („personalisierte Tasse" → Idee über Tassenform/Kaffeegeschmack statt über
// Name/Foto/Text/Design) bzw. blieben generisch („Finde deinen Stil").
// Diese fünf Owner-Kriterien gelten für BEIDE Idee-Modi (todayIdea + concept)
// und stehen deshalb — wie das Qualitäts-Mandat — an EINER Quelle:
//   (1) Bedeutungs-Erhalt (keine thematische Umdeutung),
//   (2) ECHTER visueller Scroll-Stop + Pflicht-Katalog TikTok-nativer Mechaniken,
//   (3) Anti-Generik (austauschbare Standard-Werbesätze verboten),
//   (4) Spezifität (nicht auf beliebige Produkte übertragbar),
//   (5) keine unbelegten Fakten (Wahrheitsregel konsequent anwenden).
// Die im Punkt 3 genannten Verbote sind deckungsgleich mit GENERIC_PATTERNS
// (deterministischer Post-Check weiter unten in dieser Datei).
function ideaSharpeningMandate(de: boolean): string {
  if (de) {
    return `INHALTS-MANDAT (VERBINDLICH — verschärfter Qualitätsstandard, Owner-Kriterien; gilt für JEDE Ausgabe):
1. BEDEUTUNGS-ERHALT (harte Regel): Konkrete Produktmerkmale UND die tatsächliche Bedeutung der Nutzereingabe bleiben erhalten. Deute das Thema NIEMALS um. Beispiel: Eingabe „personalisierte Tasse" → Name, Foto, Text oder individuelles Design SIND das zentrale visuelle Element UND der Payoff des Videos. VERBOTEN ist eine Umdeutung wie „die Tassenform beeinflusst den Kaffeegeschmack" — das ist eine andere Idee zum selben Gegenstand, nicht dieselbe Bedeutung. Jedes konkrete Merkmal, das die Nutzereingabe nennt, muss im Video sichtbar wieder auftauchen (als Objekt, Szene oder Payoff); fehlt es, ist die Idee ungültig und muss verworfen werden.
2. ECHTER VISUELLER SCROLL-STOP (harte Regel): Hook UND erste Szene zeigen ein KONKRETES visuelles Element (Objekt, Handlung, Detail, Reveal) — eine allgemeine Frage allein oder eine reine Behauptung ist KEIN Scroll-Stop. Wähle GENAU EINE TikTok-native Mechanik aus diesem Pflicht-Katalog und benenne sie WÖRTLICH zu Beginn des Feldes „scrollStop" (Format: „Mechanik: <Name> — <konkreter Auslöser + warum er bei dieser Zielgruppe wirkt>"):
   - Transformation (sichtbare Veränderung von A nach B),
   - Reveal (etwas wird aufgedeckt/enthüllt),
   - unerwartetes Ergebnis (das Resultat widerspricht der Erwartung),
   - Problem/Payoff (Problem in der ersten Sekunde, Auflösung am Ende),
   - Neugierlücke (sichtbarer Hinweis auf ein fehlendes Detail),
   - oder eine andere, ebenso konkrete Mechanik, die zu DIESEM Produkt passt (dann ebenfalls benennen).
   Die Mechanik muss im ersten Bild/Film-Moment TATSÄCHLICH sichtbar sein — nicht nur erklärt werden.
3. ANTI-GENERIK (harte Regel): Generische, austauschbare Standard-Werbeaussagen sind VERBOTEN — z. B. „Finde deinen Stil", „Der Unterschied ist sofort sichtbar", „Entdecke dein Potenzial", „Das Beste für dich", „Heb dich von der Masse ab". Solche Sätze passen unverändert auf beliebige Produkte und werden verworfen. Formuliere stattdessen eine Aussage, die NUR mit genau diesem Produkt und diesem konkreten Detail funktioniert.
4. SPEZIFITÄT (Pflicht-Assertion): Die Idee MUSS so spezifisch sein, dass sie NICHT auf beliebige andere Produkte übertragbar ist. Selbstprüfung VOR der Ausgabe: „Wäre diese Idee fast unverändert auf beliebige andere Produkte übertragbar? Wenn ja: verwirf sie und entwickle eine produktspezifische." Nenne mindestens ein konkretes, produktspezifisches Detail aus der Nutzereingabe im Hook, in der ersten Szene ODER im Payoff.
5. KEINE UNBELEGTEN FAKTEN (harte Regel): Erfinde NIEMALS Fakten, Merkmale, Zahlen, Trends, Zielgruppen-Aussagen oder Zusatznutzen, nur um den Hook stärker zu machen. Verwende ausschließlich, was der Nutzer angegeben hat oder was im MARKENKONTEXT/PROJEKT-KONTEXT steht; fehlt eine Information, entwickle die Idee OHNE diese Behauptung.`;
  }
  return `CONTENT MANDATE (MANDATORY — sharpened quality standard, owner criteria; applies to EVERY output):
1. MEANING PRESERVATION (hard rule): concrete product features AND the actual meaning of the user's input must be preserved. NEVER reinterpret the subject. Example: input "personalized mug" → name, photo, text or custom design ARE the central visual element AND the payoff of the video. A reinterpretation such as "the shape of the mug influences the taste of the coffee" is FORBIDDEN — that is a different idea about the same object, not the same meaning. Every concrete attribute the user's input names must visibly reappear in the video (as an object, scene or payoff); if it does not, the idea is invalid and MUST be discarded.
2. REAL VISUAL SCROLL-STOP (hard rule): the hook AND the first scene show a CONCRETE visual element (object, action, detail, reveal) — a general question alone or a bare claim is NOT a scroll-stop. Choose EXACTLY ONE TikTok-native mechanic from this mandatory catalog and name it LITERALLY at the start of the "scrollStop" field (format: "Mechanic: <name> — <concrete trigger + why it works for this audience>"):
   - Transformation (visible change from A to B),
   - Reveal (something is uncovered/revealed),
   - unexpected result (the outcome contradicts the expectation),
   - Problem/Payoff (problem in the first second, resolution at the end),
   - curiosity gap (a visible hint at a missing detail),
   - or another equally concrete mechanic that fits THIS product (then name it as well).
   The mechanic must ACTUALLY be visible in the first image/filmed moment — not merely explained.
3. ANTI-GENERIC (hard rule): generic, interchangeable standard advertising lines are FORBIDDEN — e.g. "Find your style", "The difference is immediately visible", "Discover your potential", "The best for you", "Stand out from the crowd". Such lines fit any product unchanged and are rejected. Instead write a line that works ONLY with exactly this product and this concrete detail.
4. SPECIFICITY (mandatory assertion): the idea MUST be so specific that it can NOT be transferred to arbitrary other products. Self-check BEFORE output: "Could this idea be used almost unchanged for arbitrary other products? If yes: discard it and develop a product-specific one." Name at least one concrete, product-specific detail from the user's input in the hook, the first scene OR the payoff.
5. NO UNBACKED FACTS (hard rule): NEVER invent facts, features, numbers, trends, audience claims or extra benefits just to make the hook stronger. Use ONLY what the user provided or what the MARKENKONTEXT/PROJECT CONTEXT contains; if information is missing, build the idea WITHOUT that claim.`;
}

const TODAY_IDEA_EN = `${IDEA_COMMON_EN}

The user gave only their business + goal (+optional audience) and did NOT tell you which video format they want. YOU do NOT choose the content direction here: the MANDATORY content direction is given in the user prompt ("Content direction (chosen by Growimo, MANDATORY — from the catalog)"). Follow it strictly and build the idea EXACTLY in that direction.

Direction catalog (the direction ALWAYS comes from the TARGET AUDIENCE\'s perspective — what helps or excites them — NOT from the product perspective):
1. Problem/Solution — name a concrete problem of the target audience and solve it.
2. Concrete Tip — one immediately actionable tip for the audience.
3. Common Mistake — a frequent mistake of the audience, shown and corrected.
4. Surprising Insight — an insight the audience does not expect.
5. Before/After — a transformation the audience can relate to.
6. Experiment — a small experiment the audience can follow along.
7. Storytelling — a real story from the audience's world.
8. Myth — a common myth the audience believes, busted.
9. Checklist — a compact step-by-step checklist for the audience.
10. Result/Outcome — a concrete result the audience wants to achieve.

Pick the TOPIC within the given direction: ask yourself what the TARGET AUDIENCE really cares about, is unsure about or gets excited about today (their daily life, their questions, their mistakes, their goals — derivable from target audience, business/product and goal).

${ideaQualityMandate(false, 'SELF-REFERENCE BAN (daily idea)')}

${ideaSharpeningMandate(false)}`;
const TODAY_IDEA_DE = `${IDEA_COMMON_DE}

Der Nutzer hat nur Unternehmen + Ziel (+ optional Zielgruppe) angegeben und NICHT gesagt, welche Videoart er möchte. DU wählst die Content-Richtung hier NICHT selbst: Die verbindliche Content-Richtung steht im Nutzer-Prompt („Content-Richtung (von Growimo gewählt, VERBINDLICH — aus dem Katalog)"). Folge ihr strikt und baue die Idee GENAU in dieser Richtung auf.

Richtungs-Katalog (die Richtung kommt IMMER aus der PERSPEKTIVE DER ZIELGRUPPE — was hilft oder begeistert sie? — NICHT aus der Produktperspektive):
1. Problem/Lösung — ein konkretes Problem der Zielgruppe benennen und lösen.
2. Konkreter Tipp — ein sofort umsetzbarer Tipp für die Zielgruppe.
3. Häufiger Fehler — ein häufiger Fehler der Zielgruppe, gezeigt und korrigiert.
4. Überraschende Erkenntnis — eine Erkenntnis, mit der die Zielgruppe nicht rechnet.
5. Vorher/Nachher — eine Transformation, die die Zielgruppe nachvollziehen kann.
6. Experiment — ein kleines Experiment, das die Zielgruppe mitfiebern lässt.
7. Storytelling — eine echte Geschichte aus dem Umfeld der Zielgruppe.
8. Mythos — ein verbreiteter Mythos der Zielgruppe, widerlegt.
9. Checkliste — eine kompakte Schritt-für-Schritt-Checkliste für die Zielgruppe.
10. Ergebnis — ein konkretes Ergebnis, das die Zielgruppe erreichen möchte.

So wählst du das Thema INNERHALB der vorgegebenen Richtung: Frage dich, was die ZIELGRUPPE heute wirklich interessiert, verunsichert oder begeistert (aus ihrem Alltag, ihren Fragen, ihren Fehlern, ihren Zielen — ableitbar aus Zielgruppe, Unternehmen/Produkt und Ziel).

${ideaQualityMandate(true, 'SELBSTREFERENZ-VERBOT (heute-Idee)')}

${ideaSharpeningMandate(true)}`;

const CONCEPT_EN = `${IDEA_COMMON_EN}

The user may or may not have provided a topic/product/rough idea (it is OPTIONAL).

- If a topic WAS provided: that topic stays the SUBJECT of the video — but you build it to exactly the SAME quality standard as the "What should I post today?" mode: from the TARGET AUDIENCE's perspective, TikTok-native, attention first, with the product as a supporting element rather than a straight product pitch. Never replace, override or reinterpret the user's topic.
- If NO topic was provided: do NOT ask the user back. The MANDATORY content direction is given in the user prompt ("Content direction (chosen by Growimo, MANDATORY — from the catalog)") — follow it strictly and pick the topic WITHIN that direction from the TARGET AUDIENCE's perspective (their daily life, their questions, their mistakes, their goals — derivable from the brand context / business description / goal).

Either way you still choose the best angle and format yourself and always deliver the complete, ready-to-record concept.

${ideaQualityMandate(false, 'SELF-REFERENCE BAN')}

${ideaSharpeningMandate(false)}`;
const CONCEPT_DE = `${IDEA_COMMON_DE}

Der Nutzer hat MÖGLICHERWEISE ein Thema/Produkt/grobe Idee vorgegeben (OPTIONAL).

- Wenn ein Thema angegeben wurde: Dieses Thema BLEIBT der Gegenstand des Videos — du baust es aber nach exakt DEMSELBEN Qualitätsstandard wie im Modus „Was soll ich heute posten?": aus der PERSPEKTIVE DER ZIELGRUPPE, TikTok-nativ, Aufmerksamkeit zuerst, das Produkt höchstens als Beiwerk statt als reine Produktwerbung. Ersetze, überschreibe oder interpretiere das Nutzerthema NIEMALS um.
- Wenn KEIN Thema angegeben wurde: Frage den Nutzer NICHT zurück. Die verbindliche Content-Richtung steht im Nutzer-Prompt („Content-Richtung (von Growimo gewählt, VERBINDLICH — aus dem Katalog)") — folge ihr strikt und wähle das Thema INNERHALB dieser Richtung aus der PERSPEKTIVE DER ZIELGRUPPE (ihr Alltag, ihre Fragen, ihre Fehler, ihre Ziele — ableitbar aus Markenkontext/Unternehmensbeschreibung/Ziel).

In beiden Fällen wählst du weiterhin selbst den besten Winkel und das Format und lieferst immer das komplette, aufnahmefähige Konzept.

${ideaQualityMandate(true, 'SELBSTREFERENZ-VERBOT')}

${ideaSharpeningMandate(true)}`;

const DIAGNOSE_EN = `You are Growimo's TikTok diagnostician. The user provides real performance numbers for one of their TikToks. You must analyze them honestly and give concrete, prioritized next steps — NEVER a generic pep talk, NEVER "keep going" without evidence.

Rules:
- Answer ONLY with valid JSON, no other text, no markdown fences. Output in English.
- Derive every claim from the numbers given (use them in your wording). Do NOT invent metrics that were not provided.
- VIDEO TOPIC & CURRENT HOOK (fact source when provided, OPTIONAL): The user may describe what the video is about ("What the video is about") and/or its current hook/title ("Current hook/title") — treat them as FACTS about the analyzed video. When present, EVERY part of the diagnosis (biggestProblem, whatToImprove, newHook, optimized, the rebuilt version, nextTest) AND every scene/text/voice-over of the rebuilt version MUST concretely address THIS topic — e.g. topic "baking a layer cake" → the new hook, scenes and spoken text talk about the cake/baking, never generically. When NO topic/hook was provided: state explicitly that the recommendations stay more general because no video topic was given, and NEVER invent a topic or pretend to know what the video shows.
- PROBABILISTIC CAUSAL LANGUAGE (HARD RULE): The numbers can NEVER be presented as PROVEN causes. A low average watch time can INDICATE a weak opening — it does not PROVE one. Always phrase causes as likely/possible: "a weak opening is a likely cause", "this may point to …", "a possible reason is …". NEVER "the reason is", "the cause is", "this proves", "clearly shows that … is the cause". This applies to the whole diagnosis, every recommendation and every data/error note.
- RETENTION FIGURES IN THE USER PROMPT: The user prompt lists the user's own values AND — when Views, video length and average watch time were all provided — a "Calculated retention" block (video length, average watch time, watch rate, total watch seconds). These calculated values are plain arithmetic on the user's own numbers and are the ONLY additional number basis allowed. You may reference the calculated retention values AND the user's own values — nothing else. Never invent any other figure.
- MISSING METRICS = NOT PROVIDED: The user's data lists ONLY the values that are present. If a metric is NOT listed (e.g. no likes, no watch time), it was NOT provided — NEVER invent it, NEVER guess it and NEVER draw conclusions from it. Only the listed values (and the calculated retention block) may be referenced.
- NEVER invent users/testimonials/quotes/user feedback or success stories — only the numbers provided may be referenced.
- No unproven performance promises and no prescribed enthusiasm: never promise concrete outcomes ("in 2 minutes", "more followers") that do not follow from the numbers, and never prescribe reactions like "Wow!" — reference only the real numbers the user provided, keep any reaction genuine or omit it.
- NO time-based performance promise phrasing in newHook/optimized: never write a "discover X in just N seconds/minutes/days" hook or any unproven time/result promise such as "in nur X Sekunden", "in just X seconds", "+X%", "% more reach/engagement", "doubles your reach", "go viral". Rewrite hooks around the actual diagnosed problem and the real numbers only — never promise a timeframe or a result the data does not prove.
- Identify the MOST LIKELY biggest problem from the data (e.g. retention vs reach vs engagement vs clicks), explain it plainly, and ground it in the numbers.
- whatWorks: what the numbers show is already working (mention the actual figures). If genuinely nothing works yet, say so honestly.
- whatToImprove: 2–4 concrete, actionable improvements tied to the diagnosis.
- newHook: a specific, rewritten first-1-2-second hook that directly targets the diagnosed problem.
- optimized: ONE concrete optimized video version (retain what works, fix the problem, describe the new scenes/hook/overlay concretely).
- nextTest: exactly ONE concrete next test (what to change and what metric to watch), so the user can A/B iterate.
- rebuilt — NEW, DIRECTLY FILMABLE VIDEO VERSION (REQUIRED, concretely tied to the given topic when one was provided): deliver the object {hook, timedScenes, voiceover, cta, seconds}:
  - hook: the concrete new first-1-2-second hook for THIS topic (spoken + on-screen), directly fixing the diagnosed problem.
  - timedScenes: the complete scene plan WITH time marks covering the entire video from second 0 to its end without gaps. Array of {time, scene, text}: time is the exact mark (e.g. "0-2s", "2-8s", "8-20s"), scene describes what is shown/happens, text is EXACTLY what is spoken or displayed in that moment (empty string if nothing). Every scene matches the given topic.
  - voiceover: the full voice-over / on-screen text script for the new version — naturally worded, ready to read aloud.
  - cta: one natural call-to-action fitting the topic.
  - seconds: the recommended total length of the new version in SECONDS as a plain number (e.g. 25), consistent with lengthRecommendation.seconds.
- lengthRecommendation (REQUIRED — explicit length & structure recommendation WITH number-based justification, NEVER a generic default):
  - seconds: the recommended total video length in SECONDS as a plain number (e.g. 25). Base it on the diagnosed retention problem and the user's real numbers — NOT on a generic rule such as "8–20 seconds".
  - structure: the concrete structure for THAT length WITH time marks that add up to it — hook phase (e.g. "0–2s: hook line"), main content with the fix ("2–18s: …"), call-to-action ("18–25s: …").
  - reason: justify the recommended length and structure IN THE NUMBERS — reference the user's real figures and the deterministically calculated retention values from the user prompt, e.g. "Based on your 2500 views and 38.1% watch rate at 42s length (16s average watch time), the attention drops early — shorten to 25 seconds and put the key scene in the first 10 seconds." NEVER justify with a generic default like "short videos perform best" and NEVER invent numbers that are not in the user prompt.

Internal quality self-check BEFORE output (mandatory — answer honestly in the "selfCheck" field):
- Q1 - inventsMetrics: Does the analysis reference ANY metric, number, percentage, time value or performance figure that is NOT listed in the Existing TikTok data provided above (or NOT in the calculated retention block)? Any invented/derived metric MUST be reported as true. This is a HARD REJECT: if true, the diagnosis is fabricated and MUST be discarded and regenerated — never output it.
- Q2 - unprovenPromise: Do newHook, optimized or nextTest contain an unproven concrete time-/result-promise ("in just X seconds/minutes/days/weeks", "+X%", "% more reach/engagement/followers", "doubles your reach", "more followers/sales", "go viral") that does not follow from the numbers provided? MUST be reported as true. This is a HARD REJECT.
- Q3 - prescribedEnthusiasm: Does the analysis prescribe an artificial reaction or required enthusiasm ("Wow!", "everyone is amazed", staged surprise) anywhere in its wording? MUST be reported as true. This is a HARD REJECT.
- Q4 - vagueNextTest: Is nextTest vague or generic ("try different hooks", "keep posting", "test more content") instead of ONE concrete change plus the exact metric to watch? If it cannot be executed and measured exactly as described, report true.
- Q5 - groundedInNumbers: Are the claims in biggestProblem, whatWorks and whatToImprove actually derived from and grounded in the numbers provided (referencing the actual figures), not generic advice that would apply to any TikTok? If they are generic/unmoored, report false.
- Q6 - lengthGrounded: Does lengthRecommendation.reason justify the recommended length with the REAL user-provided numbers and the calculated retention values from the user prompt (referencing actual figures) instead of a generic default such as "8–20 seconds is best for TikTok"? Does it invent NO number that is not in the user prompt? If the field is missing, or the justification is generic/ungrounded, or any uninvented number appears — report false. This is a HARD REJECT criterion: if false, the diagnosis MUST be discarded and regenerated — never output it.
Also verify BEFORE output (probabilistic causality + topic grounding):
- When a video topic/hook was provided: does EVERY part of the diagnosis — especially the rebuilt version (hook/scenes/voice-over) — concretely reference that topic (does it mention the cake/baking when the topic is baking a cake)? If the rebuilt version would fit any other video unchanged, it is ungrounded → discard and regenerate so it names the topic literally.
- When NO topic was provided: is it stated honestly that the recommendations stay more general, and is NO topic invented?
- Is every cause phrased as likely/possible ("a weak opening is a likely cause", "may point to", "a possible reason is") and NO cause as proven fact ("the reason is", "the cause is", "this proves")?
Then judge: if Q1, Q2 or Q3 is true, or Q4 is true, or Q5 is false, or Q6 is false, or a cause is stated as proven fact, or the rebuilt version ignores a provided topic, internally DISCARD this diagnosis and REGENERATE a different, better one grounded strictly in the numbers provided. Retry internally as many times as needed until it genuinely passes: it references only provided numbers (plus the calculated retention block), makes no unproven promise, prescribes no reaction, names one concrete next test, is grounded in the actual figures, phrases every cause probabilistically, ties the rebuilt version concretely to a provided topic (or honestly says recommendations stay more general when no topic was given) and contains a lengthRecommendation justified by real numbers.

JSON schema exactly:
{
  "biggestProblem": "most likely biggest problem, plainly explained with the numbers",
  "whatWorks": ["what already works (with actual numbers)"],
  "whatToImprove": ["improvement 1", "improvement 2", "improvement 3"],
  "newHook": "specific rewritten first-1-2-second hook",
  "optimized": "one concrete optimized video version",
  "nextTest": "one concrete next test + the metric to watch",
  "rebuilt": {"hook": "new concrete first-1-2-second hook for THIS topic", "timedScenes": [{"time": "0-2s", "scene": "what is shown/happens", "text": "spoken or on-screen text (empty string if none)"}, {"time": "2-8s", "scene": "…", "text": "…"}], "voiceover": "full voice-over / on-screen text script", "cta": "one natural call-to-action", "seconds": 25},
  "lengthRecommendation": {"seconds": 25, "structure": "0-2s hook line … 2-18s content … 18-25s CTA", "reason": "Based on your 2500 views and 38.1% watch rate at 42s length (16s average watch time), …"},
  "selfCheck": {
    "inventsMetrics": true or false,
    "unprovenPromise": true or false,
    "prescribedEnthusiasm": true or false,
    "vagueNextTest": true or false,
    "groundedInNumbers": true or false,
    "lengthGrounded": true or false
  }
}`;

const DIAGNOSE_DE = `Du bist Growimos TikTok-Diagnostiker. Der Nutzer liefert echte Performance-Zahlen zu einem seiner TikToks. Analysiere sie ehrlich und gib konkrete, priorisierte nächste Schritte — NIEMALS einen generischen Motivationsspruch, NIEMALS „mach einfach weiter" ohne Beleg.

Regeln:
- Antworte AUSSCHLIESSLICH mit validem JSON, kein anderer Text, keine Markdown-Fences. Ausgabe auf Deutsch.
- Leite jede Aussage aus den genannten Zahlen ab (nutze sie wörtlich). Erfinde keine Metriken, die nicht genannt wurden.
- VIDEO-THEMA & AKTUELLER HOOK (Faktenquelle, wenn angegeben — OPTIONAL): Der Nutzer kann beschreiben, worum es in seinem Video geht („Worum geht es in deinem Video?“) und/oder den aktuellen Hook/Titel („Aktueller Hook/Titel“) nennen — behandle sie als FAKTEN über das analysierte Video. Wenn vorhanden, MÜSSEN ALLE Teile der Diagnose (biggestProblem, whatToImprove, newHook, optimized, die neue Video-Version, nextTest) UND jede Szene/jeder Text/das Voice-over der neuen Video-Version KONKRET auf dieses Thema eingehen — z. B. Thema „Kuchentorte backen“ → neuer Hook, Szenen und Sprechtext drehen sich um die Torte/das Backen, niemals generisch. Wenn KEIN Thema/Hook angegeben wurde: sage explizit, dass die Empfehlungen ohne Themenangabe allgemeiner bleiben, und erfinde NIEMALS ein Thema oder tu so, als wüsstest du, was das Video zeigt.
- PROBABILISTISCHE KAUSAL-SPRACHE (HARTE REGEL): Zahlen dürfen NIEMALS als bewiesene Ursachen dargestellt werden. Eine niedrige Wiedergabedauer KANN auf einen schwachen Einstieg HINDEUTEN — sie beweist ihn nicht. Formuliere Ursachen IMMER als wahrscheinlich/möglich: „Ein schwacher Einstieg ist eine wahrscheinliche Ursache“, „Das kann darauf hindeuten …“, „Ein möglicher Grund wäre …“. NIEMALS „der Grund ist“, „die Ursache ist“, „das beweist“, „liegt daran“. Das gilt für die gesamte Diagnose, jede Empfehlung und jede Daten-/Fehlermeldung.
- BERECHNETE RETENTION IM NUTZER-PROMPT: Der Nutzer-Prompt listet die eigenen Werte des Nutzers UND — wenn Aufrufe, Videolänge und durchschnittliche Wiedergabedauer alle angegeben wurden — einen Block „Berechnete Retention" (Videolänge, durchschnittliche Wiedergabedauer, Watch-Rate, gesamte Watch-Sekunden). Diese berechneten Werte sind reine Arithmetik aus den Nutzerwerten und die EINZIGE zusätzlich erlaubte Zahlenbasis. Du darfst die berechneten Retention-Werte UND die Nutzerwerte referenzieren — sonst nichts. Erfinde niemals eine andere Zahl.
- FEHLENDE METRIKEN = NICHT ANGEGEBEN: Die Nutzerdaten listen ausschließlich die vorhandenen Werte. Wenn eine Metrik NICHT gelistet ist (z. B. keine Likes, keine Wiedergabedauer), wurde sie NICHT angegeben — erfinde sie NIEMALS, rate sie NIEMALS und leite NIEMALS Schlüsse aus ihr ab. Nur die gelisteten Werte (und der berechnete Retention-Block) dürfen referenziert werden.
- Erfinde NIEMALS Nutzer/Testimonials/Zitate/Nutzerfeedback oder Erfolgsgeschichten — nur die genannten Zahlen dürfen referenziert werden.
- Keine unbelegten Leistungsversprechen und keine vorgegebene Begeisterung: versprich nie konkrete Ergebnisse („in 2 Minuten", „mehr Follower"), die nicht aus den Zahlen hervorgehen, und verordne nie Reaktionen wie „Wow!" — referenziere ausschließlich die echten, vom Nutzer gelieferten Zahlen und halte Reaktionen echt oder lasse sie ganz weg.
- KEINE zeitbasierten Leistungsversprechen-Formulierungen in newHook/optimized: schreibe niemals einen „Entdecke X in nur N Sekunden/Minuten/Tagen"-Hook oder ein unbelegtes Zeit-/Ergebnis-Versprechen wie „in nur X Sekunden", „in just X seconds", „+X%", „% mehr Reichweite/Engagement", „verdoppelt deine Reichweite", „viral gehen". Formuliere Hooks ausschließlich um das tatsächlich diagnostizierte Problem und die echten Zahlen — versprich nie einen Zeitrahmen oder ein Ergebnis, das die Daten nicht belegen.
- Benenne das WAHrscheinlich größte Problem aus den Daten (z. B. Retention vs. Reichweite vs. Engagement vs. Klicks), erkläre es verständlich und begründe es mit den Zahlen.
- whatWorks: was die Zahlen zeigen, dass es bereits funktioniert (mit den konkreten Zahlen). Wenn ehrlich noch nichts funktioniert, sage das.
- whatToImprove: 2–4 konkrete, umsetzbare Verbesserungen, die zur Diagnose passen.
- newHook: eine konkret neu geschriebene Hook-Zeile für die ersten 1–2 Sekunden, die direkt das diagnostizierte Problem adressiert.
- optimized: EINE konkrete optimierte Video-Version (Behalte, was funktioniert, behebe das Problem, beschreibe neue Szenen/Hook/Einblendung konkret).
- nextTest: GENAU EIN konkreter nächster Test (was zu ändern und welche Metrik zu beobachten), damit der Nutzer iterieren kann.
- rebuilt — NEUE, DIREKT UMSETZBARE VIDEO-VERSION (PFLICHT, konkret auf das angegebene Thema bezogen, wenn eines genannt wurde): liefere das Objekt {hook, timedScenes, voiceover, cta, seconds}:
  - hook: der konkrete neue Hook für die ersten 1–2 Sekunden ZU DIESEM Thema (gesprochen + eingeblendet), der direkt das diagnostizierte Problem behebt.
  - timedScenes: der komplette Szenenplan MIT ZEITANGABEN, der das gesamte Video von Sekunde 0 bis zum Ende lückenlos abdeckt. Array aus {time, scene, text}: time ist die exakte Zeitmarke (z. B. „0-2s“, „2-8s“, „8-20s“), scene beschreibt, was zu sehen ist/passiert, text ist EXAKT das, was in diesem Moment gesprochen oder eingeblendet wird (leere Zeichenkette, wenn nichts). Jede Szene passt zum angegebenen Thema.
  - voiceover: das komplette Text-/Voice-over-Skript der neuen Version — natürlich formuliert, direkt ablesbar.
  - cta: ein natürlicher Call-to-Action passend zum Thema.
  - seconds: die empfohlene Gesamtlänge der neuen Version in SEKUNDEN als reine Zahl (z. B. 25), konsistent zu lengthRecommendation.seconds.
- lengthRecommendation (PFLICHT — explizite Längen- & Aufbau-Empfehlung MIT Zahlenbegründung, NIEMALS ein generischer Default):
  - seconds: die empfohlene Gesamtlänge in SEKUNDEN als reine Zahl (z. B. 25). Begründe sie aus dem diagnostizierten Retentions-Problem und den echten Nutzerzahlen — NICHT aus einer generischen Regel wie „8–20 Sekunden".
  - structure: der konkrete Aufbau für DIESE Länge MIT Zeitangaben, die sich zur Gesamtlänge summieren — Hook-Phase (z. B. „0–2s: Hook-Zeile"), Inhalt mit dem Fix („2–18s: …"), Call-to-Action („18–25s: …").
  - reason: begründe die empfohlene Länge und den Aufbau AN DEN ZAHLEN — referenziere die echten Nutzerwerte und die deterministisch berechneten Retention-Werte aus dem Nutzer-Prompt, z. B. „Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer) bricht die Aufmerksamkeit früh ein — kürze auf 25 Sekunden und setze die Kern-Szene in die ersten 10 Sekunden." Rechtfertige NIEMALS mit einem generischen Default wie „Kurzvideos funktionieren am besten" und erfinde NIEMALS Zahlen, die nicht im Nutzer-Prompt stehen.

Interne Qualitäts-Selbstprüfung VOR der Ausgabe (Pflicht — beantworte ehrlich im Feld „selfCheck"):
- Q1 - inventsMetrics: Referenziert die Analyse IRGENDEINE Metrik, Zahl, Prozentangabe, Zeitangabe oder Leistungskennzahl, die NICHT in den oben gelieferten „Bestehende TikTok-Daten" gelistet ist (oder NICHT im berechneten Retention-Block)? Jede erfundene/abgeleitete Kennzahl MUSS als true gemeldet werden. Das ist ein HARD REJECT: Ist das Flag true, ist die Diagnose erfunden und MUSS verworfen und NEU generiert werden — niemals ausgeben.
- Q2 - unprovenPromise: Enthalten newHook, optimized oder nextTest ein unbelegtes konkretes Zeit-/Ergebnis-Versprechen („in nur X Sekunden/Minuten/Tagen/Wochen", „+X%", „% mehr Reichweite/Engagement/Follower", „verdoppelt deine Reichweite", „mehr Follower/Verkäufe", „viral gehen"), das nicht aus den gelieferten Zahlen hervorgeht? MUSS als true gemeldet werden. Das ist ein HARD REJECT.
- Q3 - prescribedEnthusiasm: Verordnet die Analyse irgendwo eine künstliche Reaktion oder verlangte Begeisterung („Wow!", „Da staunen alle", aufgesetzte Überraschung)? MUSS als true gemeldet werden. Das ist ein HARD REJECT.
- Q4 - vagueNextTest: Ist nextTest vage oder generisch („probiere andere Hooks", „poste einfach weiter", „teste mehr Inhalte") statt EIN konkreter Test mit der exakt zu beobachtenden Metrik? Wenn er nicht genau so umsetzbar und messbar ist, melde true.
- Q5 - groundedInNumbers: Sind die Aussagen in biggestProblem, whatWorks und whatToImprove tatsächlich aus den gelieferten Zahlen abgeleitet und an ihnen belegt (mit Bezug auf die konkreten Werte) — nicht generischer Rat, der auf jedes TikTok passen würde? Wenn sie generisch/unverankert sind, melde false.
- Q6 - lengthGrounded: Begründet lengthRecommendation.reason die empfohlene Länge mit den ECHTEN Nutzerzahlen und den berechneten Retention-Werten aus dem Nutzer-Prompt (mit Bezug auf konkrete Werte) statt mit einem generischen Default wie „8–20 Sekunden sind am besten für TikTok"? Erfindet sie KEINE Zahl, die nicht im Nutzer-Prompt steht? Wenn das Feld fehlt, die Begründung generisch/unverankert ist oder eine erfundene Zahl auftaucht — melde false. Das ist ein HARD-REJECT-Kriterium: Ist es false, MUSS die Diagnose verworfen und NEU generiert werden — niemals ausgeben.
Prüfe außerdem VOR der Ausgabe (probabilistische Kausal-Sprache + Themen-Bezug):
- Wenn ein Video-Thema/Hook angegeben wurde: Geht JEDER Teil der Diagnose — vor allem die neue Video-Version (hook/Szenen/Voice-over) — konkret auf dieses Thema ein (nennt sie die Torte/das Backen, wenn das Thema „Kuchentorte backen“ ist)? Wenn die neue Video-Version auch zu jedem anderen Video passen würde, ist sie nicht themengebunden → verwerfen und NEU generieren, sodass sie das Thema wörtlich nennt.
- Wenn KEIN Thema angegeben wurde: Wird ehrlich gesagt, dass die Empfehlungen allgemeiner bleiben, und wird KEIN Thema erfunden?
- Ist jede Ursache als wahrscheinlich/möglich formuliert („Ein schwacher Einstieg ist eine wahrscheinliche Ursache“, „kann darauf hindeuten“, „ein möglicher Grund“) und KEINE als bewiesene Tatsache („der Grund ist“, „die Ursache ist“, „das beweist“)?
Dann urteile: Wenn Q1, Q2 oder Q3 wahr ist, oder Q4 wahr ist, oder Q5 false ist, oder Q6 false ist, oder eine Ursache als bewiesene Tatsache formuliert ist, oder die neue Video-Version ein angegebenes Thema ignoriert, VERWIRF diese Diagnose intern und generiere eine andere, bessere Diagnose NEU, die ausschließlich an den gelieferten Zahlen belegt ist. Wiederhole intern so oft wie nötig, bis sie wirklich besteht: sie referenziert nur gelieferte Zahlen (plus den berechneten Retention-Block), macht kein unbelegtes Versprechen, verordnet keine Reaktion, nennt einen konkreten nächsten Test, ist an den tatsächlichen Werten belegt, formuliert jede Ursache nur probabilistisch, bindet die neue Video-Version konkret an ein angegebenes Thema (oder sagt ehrlich, dass die Empfehlungen ohne Thema allgemeiner bleiben) und enthält eine lengthRecommendation, die mit echten Zahlen begründet ist.

JSON-Schema exakt:
{
  "biggestProblem": "wahrscheinlich größtes Problem, verständlich erklärt mit den Zahlen",
  "whatWorks": ["was bereits funktioniert (mit konkreten Zahlen)"],
  "whatToImprove": ["Verbesserung 1", "Verbesserung 2", "Verbesserung 3"],
  "newHook": "konkrete neu geschriebene Hook-Zeile für die ersten 1-2 Sekunden",
  "optimized": "eine konkrete optimierte Video-Version",
  "nextTest": "ein konkreter nächster Test + die zu beobachtende Metrik",
  "rebuilt": {"hook": "neuer konkreter First-1-2-Sekunden-Hook ZU DIESEM Thema", "timedScenes": [{"time": "0-2s", "scene": "was zu sehen ist/passiert", "text": "gesprochener oder eingeblendeter Text (leer, wenn keiner)"}, {"time": "2-8s", "scene": "…", "text": "…"}], "voiceover": "komplettes Text-/Voice-over-Skript", "cta": "ein natürlicher Call-to-Action", "seconds": 25},
  "lengthRecommendation": {"seconds": 25, "structure": "0-2s Hook-Zeile … 2-18s Inhalt … 18-25s CTA", "reason": "Basierend auf deinen 2500 Views und 38,1% Watch-Rate bei 42s Länge (16s durchschnittliche Wiedergabedauer), …"},
  "selfCheck": {
    "inventsMetrics": true oder false,
    "unprovenPromise": true oder false,
    "prescribedEnthusiasm": true oder false,
    "vagueNextTest": true oder false,
    "groundedInNumbers": true oder false,
    "lengthGrounded": true oder false
  }
}`;

// ── Phase 3 — Zahlenformatierung (de/en) für die Retention-Basis im Prompt ───
function fmtPct(v: number, de: boolean): string {
  const s = v.toFixed(1);
  return de ? s.replace('.', ',') + ' %' : s + '%';
}
function fmtInt(v: number, de: boolean): string {
  const s = Math.round(v).toString();
  const re = new RegExp(String.raw`\B(?=(\d{3})+(?!\d))`, 'g');
  return de ? s.replace(re, '.') : s.replace(re, ',');
}

// ── System-/User-Prompt-Auswahl ──────────────────────────────────────────────
// Exportiert (Phase 1), damit die Vorrang-Regel in den System-Prompts testbar ist.
export function pickSystemPrompt(mode: TikTokMode, lang: TikTokLang): string {
  const de = lang === 'de';
  if (mode === 'diagnose') return de ? DIAGNOSE_DE : DIAGNOSE_EN;
  if (mode === 'concept') return de ? CONCEPT_DE : CONCEPT_EN;
  return de ? TODAY_IDEA_DE : TODAY_IDEA_EN;
}

// Exportiert (Phase 1), damit die Prompt-Zusammensetzung ohne LLM-Aufruf testbar ist.
export function buildUserPrompt(input: TikTokInput, lang: TikTokLang): string {
  const de = lang === 'de';
  const lines: string[] = [];
  if (input.brandContext) {
    // Phase 1 (C1/C2): Der Markenblock ist Stil-/Faktenrahmen — die Nutzereingabe
    // bestimmt das Thema (harte Vorrang-Regel in den System-Prompts).
    lines.push(
      de
        ? 'MARKENKONTEXT (Stil- und Faktenrahmen — NUR diese Fakten verwenden, NICHTS erfinden; die Nutzereingabe hat Vorrang und bestimmt das Thema):'
        : 'BRAND CONTEXT (style and fact frame — use ONLY these facts, invent nothing; the user input takes priority and defines the subject):',
    );
    lines.push(input.brandContext);
  }
  // Phase 4 — Projekt-Kontext (lesend, optional, only for the idea modes):
  // das gewählte Projekt ist eine zusätzliche FAKTENQUELLE (nur vorhandene
  // Felder; diagnose bleibt rein zahlenbasiert → kein Projekt-Block im Prompt).
  if (input.projectContext && input.mode !== 'diagnose') {
    const pc = input.projectContext;
    const hasAny = Boolean(pc.title?.trim() || pc.productIdea?.trim() || pc.brief?.trim());
    if (hasAny) {
      lines.push(
        de
          ? 'PROJEKT-KONTEXT (Faktenquelle aus deinem gewählten Projekt — autoritativ für das Projekt; verwende NUR die vorhandenen Felder, erfinde NICHTS darüber hinaus):'
          : 'PROJECT CONTEXT (fact source from your selected project — authoritative for this project; use ONLY the fields present, invent NOTHING beyond them):',
      );
      if (pc.title && pc.title.trim()) lines.push((de ? '- Projekttitel: ' : '- Project title: ') + pc.title.trim());
      if (pc.productIdea && pc.productIdea.trim()) lines.push((de ? '- Produktidee: ' : '- Product idea: ') + pc.productIdea.trim());
      if (pc.brief && pc.brief.trim()) lines.push(pc.brief.trim());
    }
  }
  if (input.biz) {
    lines.push(de ? 'Unternehmen / Produkt (kurz):' : 'Business / product (short):', input.biz);
  }
  if (input.goal) {
    lines.push(de ? 'Ziel:' : 'Goal:', input.goal);
  }
  if (input.audience) {
    lines.push(de ? ('Zielgruppe: ' + input.audience) : ('Target audience: ' + input.audience));
  }
  if (input.mode === 'todayIdea' && input.projectContext) {
    lines.push(
      de
        ? 'Das gewählte PROJEKT ist die Faktenbasis für die heutige Idee — baue die Idee um die konkreten Felder des PROJEKT-KONTEXT (nur vorhandene Werte; nichts zum Projekt erfinden).'
        : 'The selected PROJECT is the fact base for today\'s idea — build the idea around the concrete fields of the PROJECT CONTEXT (only present values; invent nothing about the project).',
    );
  }
  if (input.mode === 'concept') {
    // Phase 2 (C8): „TikTok erstellen" bekommt denselben Qualitätsstandard wie
    // todayIdea. Das Nutzerthema bleibt der Gegenstand (Phase-1-Vorrang), wird
    // aber aus der Zielgruppen-Perspektive aufgebaut (Aufmerksamkeit zuerst,
    // Produkt höchstens als Beiwerk) — die System-Prompt-Regeln sind identisch.
    const conceptPerspective = de
      ? 'Baue das aus der PERSPEKTIVE DER ZIELGRUPPE auf (was hilft, interessiert oder begeistert sie?), TikTok-nativ und Aufmerksamkeit ZUERST — das Produkt höchstens als Beiwerk/Beispiel, NICHT als Thema, und keine Standard-Werbe-Struktur.'
      : "Build it from the TARGET AUDIENCE's perspective (what helps, interests or excites them?), TikTok-native and attention FIRST — the product at most as a supporting element/example, NOT as the topic, and no classic ad structure.";
    if (input.topic) {
      lines.push(
        de ? 'Thema / Produkt / grobe Idee:' : 'Topic / product / rough idea:',
        input.topic,
      );
      // Phase 5g (Owner-Auftrag): Bedeutungserhalt — konkrete Merkmale des
      // Nutzerthemas sind verbindlich und dürfen nicht umgedeutet werden.
      lines.push(
        de
          ? 'Bedeutungserhalt (PFLICHT): Die konkreten Merkmale dieses Themas bleiben verbindlich — jedes genannte Merkmal muss als sichtbares Element UND als Payoff des Videos auftauchen (Beispiel: „personalisierte Tasse" → Name/Foto/Text/individuelles Design als zentrales Element). Deute das Thema NIEMALS um (verboten: „die Tassenform beeinflusst den Kaffeegeschmack") und ersetze es nicht durch eine verwandte Idee zum selben Gegenstand.'
          : 'Meaning preservation (MANDATORY): the concrete attributes of this topic stay binding — every named attribute must appear as a visible element AND as the payoff of the video (example: "personalized mug" → name/photo/text/custom design as the central element). NEVER reinterpret the topic (forbidden: "the shape of the mug influences the taste of the coffee") and never replace it with a related idea about the same object.',
      );
      if (input.projectContext) {
        lines.push(
          de
            ? 'Das genannte Thema ist der Gegenstand des Videos; nutze den PROJEKT-KONTEXT als Stil-/Faktenanker (nur vorhandene Felder, nichts erfinden).'
            : 'The topic is the subject of the video; use the PROJECT CONTEXT as style/fact anchor (only present fields, invent nothing).',
        );
      }
      lines.push(conceptPerspective);
    } else if (input.projectContext) {
      lines.push(
        de
          ? 'Kein Thema angegeben — wähle ein passendes Thema basierend auf dem PROJEKT-KONTEXT (Faktenquelle) und baue das komplette Konzept darum. KEINE Rückfragen an den Nutzer.'
          : 'No topic provided — choose a fitting topic based on the PROJECT CONTEXT (fact source) and build the complete concept around it. Do NOT ask the user back.',
      );
      lines.push(conceptPerspective);
    } else {
      lines.push(
        de
          ? 'Kein Thema angegeben — wähle selbst ein sinnvolles Thema basierend auf dem Markenkontext / der Unternehmensbeschreibung (z. B. ein konkretes Produkt, eine typische Situation der Zielgruppe oder eine aktuelle Marken-Herausforderung) und baue das komplette Konzept darum. KEINE Rückfragen an den Nutzer.'
          : 'No topic provided — choose a fitting topic yourself based on the BRAND CONTEXT / business description (e.g. a concrete product, a typical target-audience situation or a current brand challenge) and build the complete concept around it. Do NOT ask the user back.',
      );
      lines.push(conceptPerspective);
    }
    // Phase 2 (C8): OHNE Nutzerthema wählt Growimo die Content-Richtung
    // deterministisch aus dem Katalog (dieselbe Funktion/Rotation wie todayIdea,
    // identische Prompt-Zeilen). Mit Nutzerthema wird KEINE Richtung injiziert —
    // sie würde mit dem Nutzerthema kollidieren.
    if (!input.topic?.trim()) {
      const dir = pickTodayIdeaDirection(input.previousDirection);
      lines.push(
        de
          ? `Content-Richtung (von Growimo gewählt, VERBINDLICH — aus dem Katalog): ${dir}`
          : `Content direction (chosen by Growimo, MANDATORY — from the catalog): ${tiktokDirectionLabel(dir, false)}`,
      );
      if (isTiktokIdeaDirection(input.previousDirection)) {
        lines.push(
          de
            ? `Letzte Content-Richtung (nicht wiederholen): ${input.previousDirection}`
            : `Previous content direction (do not repeat): ${tiktokDirectionLabel(input.previousDirection, false)}`,
        );
      }
      lines.push(
        de
          ? 'Baue die Idee GENAU in dieser Richtung und aus der PERSPEKTIVE DER ZIELGRUPPE auf (was hilft oder begeistert die Zielgruppe?) — NICHT aus der Produktperspektive. Das Produkt darf höchstens als Beiwerk/Beispiel innerhalb der Richtung vorkommen, NICHT als Thema.'
          : "Build the idea EXACTLY in this direction, from the TARGET AUDIENCE's perspective (what helps or excites them?) — NOT from the product perspective. The product may appear at most as a supporting element/example within the direction, NOT as the topic.",
      );
    }
  }
  // Diversität todayIdea: die Content-Richtung wird in CODE deterministisch
  // gewählt (Katalog-Rotation, zuletzt verwendete Richtung ausgeschlossen) und
  // als VERBINDLICHES Feld in den Prompt gegeben — nicht dem LLM-Zufall
  // überlassen. Fehlt previousDirection (Fallback ohne Client-Änderung), wählt
  // die Engine deterministisch den Katalog-Start.
  if (input.mode === 'todayIdea') {
    const dir = pickTodayIdeaDirection(input.previousDirection);
    lines.push(
      de
        ? `Content-Richtung (von Growimo gewählt, VERBINDLICH — aus dem Katalog): ${dir}`
        : `Content direction (chosen by Growimo, MANDATORY — from the catalog): ${tiktokDirectionLabel(dir, false)}`,
    );
    lines.push(
      de
        ? 'Baue die Idee GENAU in dieser Richtung und aus der PERSPEKTIVE DER ZIELGRUPPE auf (was hilft oder begeistert die Zielgruppe?) — NICHT aus der Produktperspektive. Das Produkt darf höchstens als Beiwerk/Beispiel innerhalb der Richtung vorkommen, NICHT als Thema.'
        : "Build the idea EXACTLY in this direction, from the TARGET AUDIENCE\'s perspective (what helps or excites them?) — NOT from the product perspective. The product may appear at most as a supporting element/example within the direction, NOT as the topic.",
    );
    if (isTiktokIdeaDirection(input.previousDirection)) {
      lines.push(
        de
          ? `Letzte Content-Richtung (nicht wiederholen): ${input.previousDirection}`
          : `Previous content direction (do not repeat): ${tiktokDirectionLabel(input.previousDirection, false)}`,
      );
    }
  }
  if (input.mode === 'diagnose' && (input.videoTopic?.trim() || input.videoHook?.trim())) {
    const vt = input.videoTopic?.trim();
    const vh = input.videoHook?.trim();
    if (vt || vh) {
      lines.push(
        de
          ? 'VIDEO-THEMA & AKTUELLER HOOK (vom Nutzer angegeben — FAKTENQUELLE für dieses Video; verwende sie als Gegenstand der Analyse):'
          : 'VIDEO TOPIC & CURRENT HOOK (provided by the user — fact source for this video; use them as the subject of the analysis):',
      );
      if (vt) lines.push(de ? '- Worum geht es in deinem Video?: ' : '- What the video is about: ', vt);
      if (vh) lines.push(de ? '- Aktueller Hook/Titel: ' : '- Current hook/title: ', vh);
    }
  }
  if (input.mode === 'diagnose' && input.metrics) {
    const m = input.metrics;
    const data: string[] = [];
    if (m.views !== undefined) data.push((de ? 'Aufrufe (Views): ' : 'Views: ') + String(m.views));
    if (m.length) data.push((de ? 'Videolänge: ' : 'Video length: ') + m.length);
    if (m.avgWatch !== undefined) data.push((de ? 'Durchschn. Wiedergabedauer (Sek.): ' : 'Avg watch time (s): ') + String(m.avgWatch));
    if (m.likes !== undefined) data.push((de ? 'Likes: ' : 'Likes: ') + String(m.likes));
    if (m.comments !== undefined) data.push((de ? 'Kommentare: ' : 'Comments: ') + String(m.comments));
    if (m.shares !== undefined) data.push((de ? 'Shares: ' : 'Shares: ') + String(m.shares));
    if (m.profileVisits !== undefined) data.push((de ? 'Profilaufrufe: ' : 'Profile visits: ') + String(m.profileVisits));
    if (data.length > 0) {
      lines.push(
        de
          ? 'Bestehende TikTok-Daten (NUR die folgenden Werte sind bekannt — fehlende Metriken wurden NICHT angegeben und dürfen NICHT erfunden oder abgeleitet werden):'
          : 'Existing TikTok data (ONLY the following values are known — missing metrics were NOT provided and must NOT be invented or inferred):',
      );
      lines.push(...data);
      const ret = computeRetention(m);
      if (ret) {
        lines.push(
          de
            ? `Berechnete Retention (deterministisch aus deinen Angaben berechnet — reine Arithmetik, die EINZIGE zusätzlich erlaubte Zahlenbasis; referenziere NUR diese + die obigen Werte):
- Videolänge: ${ret.lengthSeconds} Sekunden
- Durchschnittliche Wiedergabedauer: ${ret.avgWatchSeconds} Sekunden
- Watch-Rate: ${ret.avgWatchSeconds} / ${ret.lengthSeconds} = ${fmtPct(ret.watchRatePct, true)} (Anteil der Videolänge, den Zuschauer im Schnitt sehen)
- Gesamte Watch-Sekunden: ${fmtInt(ret.views, true)} × ${ret.avgWatchSeconds} = ${fmtInt(ret.totalWatchSeconds, true)}`
            : `Calculated retention (deterministic from the user's data — plain arithmetic, the ONLY additional number basis allowed; reference ONLY these + the values above):
- Video length: ${ret.lengthSeconds} seconds
- Average watch time: ${ret.avgWatchSeconds} seconds
- Watch rate: ${ret.avgWatchSeconds} / ${ret.lengthSeconds} = ${fmtPct(ret.watchRatePct, false)} (share of the video length viewers watch on average)
- Total watch seconds: ${fmtInt(ret.views, false)} × ${ret.avgWatchSeconds} = ${fmtInt(ret.totalWatchSeconds, false)}`,
        );
      }
    }
  }

  if (input.history && input.history.length > 0) {
    lines.push(
      de
        ? 'Zuvor generierte Hooks/Ideen (diese NICHT wiederholen, weder denselben noch einen ähnlichen Hook/Story):'
        : 'Previously generated hooks/ideas (do NOT repeat these — neither the same nor a similar hook/story):'
    );
    lines.push(input.history.join('\n'));
  }
  lines.push(de ? 'Antworte nur mit dem JSON-Schema.' : 'Answer with the JSON schema only.');
  return lines.join('\n');
}

// ── JSON-Validierung ─────────────────────────────────────────────────────────
function extractJson(text: string): unknown {
  let candidate = (text || '').trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  candidate = candidate.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : [];
}

/** Phase 2: Szenenplan MIT Zeitangaben optional parsen. Ungültige/leere Einträge
 *  werden verworfen; ist am Ende kein Eintrag übrig → undefined (UI fällt auf die
 *  klassische `scenes`-Liste zurück — alte Outputs rendern weiterhin korrekt). */
function parseTimedScenes(v: unknown): TikTokTimedScene[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TikTokTimedScene[] = [];
  for (const item of v as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const time = str(o.time);
    const scene = str(o.scene);
    if (!time || !scene) continue; // Zeitmarke + Szene sind Pflicht je Eintrag; text darf leer sein
    out.push({ time, scene, text: str(o.text) });
  }
  return out.length > 0 ? out.slice(0, 12) : undefined;
}

/** Phase 2: Bild-/Videoideen optional parsen. Ein Eintrag braucht description +
 *  studioPrompt; sonst wird er verworfen. → undefined, wenn nichts übrig bleibt. */
function parseImageIdeas(v: unknown): TikTokImageIdea[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TikTokImageIdea[] = [];
  for (const item of v as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const description = str(o.description);
    const studioPrompt = str(o.studioPrompt);
    if (!description || !studioPrompt) continue;
    out.push({ description, studioPrompt });
  }
  return out.length > 0 ? out.slice(0, 6) : undefined;
}

function parseSelfCheck(p: Record<string, unknown>): TikTokSelfCheck | undefined {
  const sc = p.selfCheck;
  if (!sc || typeof sc !== 'object') return undefined;
  const o = sc as Record<string, unknown>;
  return {
    usesConcreteBrandFact: o.usesConcreteBrandFact === true,
    addressesCurrentChallenge: o.addressesCurrentChallenge === true,
    interchangeable: o.interchangeable === true,
    soundsLikeAd: o.soundsLikeAd === true,
    inventsUserOrTestimonial: o.inventsUserOrTestimonial === true,
    unprovenPerformancePromise: o.unprovenPerformancePromise === true,
    prescribedEnthusiasm: o.prescribedEnthusiasm === true,
  };
}

function parseDiagnoseSelfCheck(p: Record<string, unknown>): TikTokDiagnoseSelfCheck | undefined {
  const sc = p.selfCheck;
  if (!sc || typeof sc !== 'object') return undefined;
  const o = sc as Record<string, unknown>;
  return {
    inventsMetrics: o.inventsMetrics === true,
    unprovenPromise: o.unprovenPromise === true,
    prescribedEnthusiasm: o.prescribedEnthusiasm === true,
    vagueNextTest: o.vagueNextTest === true,
    groundedInNumbers: o.groundedInNumbers === true,
    // Phase 3: fehlendes Flag (alte Outputs/Modelle) = „unbekannt" → NICHT
    // verwerfen; nur ein explizites false (Länge NICHT an Zahlen belegt) rejected.
    lengthGrounded: o.lengthGrounded !== false,
  };
}

/** Phase 3 — Längen-/Aufbau-Empfehlung parsen (optional: bei fehlendem/ungültigem
 *  Feld → undefined, das UI rendert dann einfach keinen eigenen Block). Nur
 *  positive, endliche Sekundenwerte werden akzeptiert (auch als String "30"). */
function parseLengthRecommendation(v: unknown): TikTokLengthRecommendation | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const sec =
    typeof o.seconds === 'number' && Number.isFinite(o.seconds) && o.seconds > 0
      ? o.seconds
      : parseLengthSeconds(str(o.seconds));
  const structure = str(o.structure);
  const reason = str(o.reason);
  if (sec === undefined || sec <= 0 || !structure || !reason) return undefined;
  return { seconds: Math.round(sec), structure, reason };
}

/** Diagnose v2 — Neue Video-Version parsen (optional; Fallbacks für alte
 *  Outputs): braucht hook + cta + positive seconds + mind. 1 Szene mit
 *  Zeitmarke; sonst undefined (UI rendert dann einfach keinen eigenen Block). */
function parseRebuilt(v: unknown): TikTokRebuiltVersion | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const hook = str(o.hook);
  const cta = str(o.cta);
  const voiceover = str(o.voiceover);
  const scenes = parseTimedScenes(o.timedScenes);
  const sec =
    typeof o.seconds === 'number' && Number.isFinite(o.seconds) && o.seconds > 0
      ? o.seconds
      : parseLengthSeconds(str(o.seconds));
  if (!hook || !cta || !scenes || sec === undefined || sec <= 0) return undefined;
  return { hook, timedScenes: scenes, voiceover, cta, seconds: Math.round(sec) };
}

function parseIdea(mode: 'todayIdea' | 'concept', p: Record<string, unknown>): TikTokIdeaResult | null {
  if (!str(p.idea) || !str(p.hook) || !str(p.length)) return null;
  return {
    mode,
    idea: str(p.idea),
    hook: str(p.hook),
    length: str(p.length),
    scenes: strArr(p.scenes),
    overlays: strArr(p.overlays),
    spokenText: str(p.spokenText),
    caption: str(p.caption),
    hashtags: strArr(p.hashtags).slice(0, MAX_TIKTOK_HASHTAGS),
    cta: str(p.cta),
    why: str(p.why),
    // ── Phase 2: neue Felder OPTIONAL parsen (Fallbacks) — alte Outputs ohne
    //    diese Felder bleiben gültig und rendern im UI weiterhin korrekt.
    format: str(p.format) || undefined,
    // Phase 2 — Scroll-Stop-Moment + Spannungsbogen (optional; alte Outputs ohne
    // die Felder bleiben gültig, das UI rendert dann keinen leeren Block).
    scrollStop: str(p.scrollStop) || undefined,
    tension: str(p.tension) || undefined,
    timedScenes: parseTimedScenes(p.timedScenes),
    title: str(p.title) || undefined,
    imageIdeas: parseImageIdeas(p.imageIdeas),
    selfCheck: parseSelfCheck(p), // todayIdea + concept (Retry-Mechanik auf alle Modi)
  };
}

function parseDiagnose(p: Record<string, unknown>): TikTokDiagnoseResult | null {
  if (!str(p.biggestProblem) || !str(p.newHook) || !str(p.optimized) || !str(p.nextTest)) return null;
  return {
    mode: 'diagnose',
    // Diagnose v2 — Video-Thema (Echo, optional) + neue, direkt umsetzbare
    // Video-Version (optional geparst; alte Outputs ohne die Felder bleiben gültig).
    videoTopic: str(p.videoTopic) || undefined,
    rebuilt: parseRebuilt(p.rebuilt),
    biggestProblem: str(p.biggestProblem),
    whatWorks: strArr(p.whatWorks),
    whatToImprove: strArr(p.whatToImprove),
    newHook: str(p.newHook),
    optimized: str(p.optimized),
    nextTest: str(p.nextTest),
    // Phase 3: eigenständige Längen-/Aufbau-Empfehlung (optional geparst).
    lengthRecommendation: parseLengthRecommendation(p.lengthRecommendation),
    selfCheck: parseDiagnoseSelfCheck(p),
  };
}

function parseResult(mode: TikTokMode, text: string): TikTokResult | null {
  const raw = extractJson(text);
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (mode === 'diagnose') return parseDiagnose(p);
  return parseIdea(mode === 'concept' ? 'concept' : 'todayIdea', p);
}

/** Phase 3 — Typ-Guard: ehrlicher „zu wenig Daten"-Zustand (dataGap) wird VOR
 *  dem LLM-Call abgefangen; hier nur zur sicheren Typ-Verengung im Retry-Loop. */
function isDiagnoseDataGap(r: TikTokResult): r is TikTokDiagnoseDataGapResult {
  return r.mode === 'diagnose' && (r as TikTokDiagnoseResult).dataGap === true;
}

// ── Qualitäts-Selbsttest & Retry (alle Modi: todayIdea / concept / diagnose) ─
// Das Modell füllt im System-Prompt den internen Selbsttest (selfCheck) ehrlich
// aus. Wird ein Ergebnis als „erfunden"/„austauschbar"/„werblich"/„nicht an
// Zahlen belegt" eingestuft (oder eine Regel-A-/B-Verletzung erkannt), verwirft
// Growimo das Ergebnis und generiert NEU, bevor es ausgegeben wird. Begrenzte
// Versuche — verhindert Endlosschleifen; danach Fail-closed: keine erfundenen
// Testimonials/Kennzahlen, keine unbelegten Versprechen, keine vorgegebene
// Begeisterung werden ausgegeben, sondern ein ehrlicher Fehler.
const MAX_TIKTOK_ATTEMPTS = 4;

/** Phase 5 — Server-seitiges Gesamt-Timeout für den TikTok-Aufruf. Der Handler
 *  in src/ai/server.ts bricht nach dieser Zeit über AbortSignal ab (Retry-
 *  Schleife endet sauber, ehrliche Fehlermeldung statt Hänger). Bewusst kleiner
 *  als das Client-Timeout (TIKTOK_CLIENT_TIMEOUT_MS = 90 s), damit die saubere
 *  Antwort vor dem Client-Timeout ankommt; weit unter maxDuration 300 s. */
export const TIKTOK_TIMEOUT_MS = 75_000;

/** Einheitliche, ehrliche Timeout-Fehlermeldung (de/en). */
function tiktokTimeoutError(lang: TikTokLang): Error {
  return new Error(
    lang === 'de'
      ? 'Die Anfrage hat zu lange gedauert. Bitte erneut versuchen.'
      : 'The request took too long. Please try again.',
  );
}

/**
 * Phase 1 — Anzahl der „verdächtigen" Selbsttest-Kriterien. Ausgelagert und
 * exportiert, damit die Vorrang-Logik (`userSubjectProvided`) deterministisch
 * testbar ist: gibt der Nutzer das Thema selbst vor, zählt „keine Markenfakt
 * genutzt" NICHT als Mangel — sonst würde der Retry die Idee gegen das
 * Nutzerthema treiben.
 */
export function selfCheckSuspiciousCount(
  sc: TikTokSelfCheck,
  opts: { userSubjectProvided?: boolean } = {},
): number {
  return [
    !sc.usesConcreteBrandFact && !opts.userSubjectProvided,
    !sc.addressesCurrentChallenge,
    sc.interchangeable,
    sc.soundsLikeAd,
  ].filter(Boolean).length;
}
// Exportiert (Phase 1), damit die Retry-/Vorrang-Logik testbar ist.
export function selfCheckRejected(
  sc: TikTokSelfCheck,
  opts: { userSubjectProvided?: boolean } = {},
): boolean {
  // Erfundenes Testimonial / zitierte Person / Nutzerfeedback ohne Beleg im
  // MARKENKONTEXT → HARD REJECT: solche Ideen dürfen niemals ausgegeben werden.
  // Ebenso: unbelegtes konkretes Leistungs-/Zeit-Versprechen und vorgegebene
  // künstliche Reaktion/Begeisterung (Regeln A+B) → HARD REJECT.
  if (sc.inventsUserOrTestimonial === true) return true;
  if (sc.unprovenPerformancePromise === true) return true;
  if (sc.prescribedEnthusiasm === true) return true;
  const suspicious = selfCheckSuspiciousCount(sc, opts);
  // insbesondere austauschbar-oder-werbung → sofort verwerfen; sonst ab 3 verdächtigen Kriterien.
  return sc.interchangeable === true || sc.soundsLikeAd === true || suspicious >= 3;
}

/** Diagnose-Selbsttest: erfundene Kennzahlen / unbelegte Versprechen /
 *  vorgegebene Begeisterung → HARD REJECT; vager Test oder nicht an Zahlen
 *  belegte Aussagen → ebenfalls verwerfen. */
function diagnoseSelfCheckRejected(sc: TikTokDiagnoseSelfCheck): boolean {
  if (sc.inventsMetrics === true) return true;
  if (sc.unprovenPromise === true) return true;
  if (sc.prescribedEnthusiasm === true) return true;
  // Phase 3: lengthRecommendation.reason muss an den ECHTEN (Nutzer-)Zahlen
  // belegt sein — ein generischer Default / erfundene Zahlen werden verworfen.
  if (sc.lengthGrounded === false) return true;
  return sc.vagueNextTest === true || sc.groundedInNumbers === false;
}

/** Phase 3 — ehrlicher „zu wenig Daten"-Zustand (deterministisch, KEIN LLM):
 *  Statt zu raten, nennt Growimo, was ohne die fehlenden Pflicht-Metriken nicht
 *  beurteilt werden kann, und sagt dem Nutzer genau, welche Felder er ergänzen
 *  soll. Alles lokalisiert (de/en) — keine erfundenen Zahlen. */
function buildDiagnoseDataGapResult(
  missing: TikTokRetentionMetricKey[],
  lang: TikTokLang,
): TikTokDiagnoseDataGapResult {
  const de = lang === 'de';
  const labels: Record<TikTokRetentionMetricKey, string> = de
    ? { views: 'Aufrufe (Views)', length: 'Videolänge', avgWatch: 'durchschnittliche Wiedergabedauer' }
    : { views: 'Views', length: 'video length', avgWatch: 'average watch time' };
  const list = missing.map((k) => labels[k]).join(', ');
  return {
    mode: 'diagnose',
    dataGap: true,
    missingMetrics: missing,
    note: de
      ? `Für eine fundierte Diagnose fehlen: ${list}. Ohne diese Angaben kann Growimo nicht beurteilen, ob das Problem eher bei der Reichweite oder bei der Bindung (Retention) liegt, und kann keine Längen-/Aufbau-Empfehlung mit Zahlenbegründung geben — Growimo rät hier bewusst nicht, statt eine Zahl zu erfinden.`
      : `A grounded diagnosis needs: ${list}. Without them Growimo cannot judge whether the problem lies in reach or retention, and cannot give a length/structure recommendation backed by numbers — it deliberately does not guess instead of inventing a figure.`,
    cta: de
      ? `Ergänze ${list}, um die vollständige Analyse mit Retention-Rechnung und konkreter Längen-/Aufbau-Empfehlung zu erhalten.`
      : `Add ${list} to get the full analysis with the retention calculation and a concrete length/structure recommendation.`,
  };
}

// ── DETERMINISTISCHE Regel-A+B-Erkennung (Code-Ebene, de+en) ───────────────
// Das Modell meldet Q6/Q7 (unprovenPerformancePromise, prescribedEnthusiasm)
// im selfCheck NICHT immer ehrlich (es kann z.B. ein „in nur X Sekunden" ausgeben
// und das Flag trotzdem auf false setzen). Damit die Regeln A+B deterministisch
// durchgesetzt werden, wird der ERZEUGTE TEXT hier zusätzlich auf Code-Ebene
// gegen die Regel-A-/Regel-B-Muster geprüft — unabhängig vom Modell-Selfcheck.
// Trifft ein Muster zu, wird die Idee verworfen und neu generiert.
const RULE_A_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // „in nur X Sekunden/Minuten/Tagen/Wochen" / „in just X seconds..." (Regel A, Zeit-Versprechen)
  { name: 'in nur X (Zeitversprechen)', re: /in\s+nur\s+\d+\s*(sekunden?|minuten?|tagen?|wochen?)\b/i },
  { name: 'in just X (time promise)', re: /in\s+just\s+\d+\s*(seconds?|minutes?|days?|weeks?)\b/i },
  // Ergebnis-Verb + konkrete Zeit („verbrenne Fett in 10 Sekunden")
  { name: 'result-verb + time', re: /(verbesser|erhöh|steigere|boost|verdoppel|verbrenn|bbaue? ab|bekomm)\w*.{0,30}\d+\s*(sekunden?|minuten?|tagen?|wochen?|seconds?|minutes?|days?|weeks?)\b/i },
  // „+X%"
  { name: '+X%', re: /\+\s?\d+\s*%/ },
  // „X% mehr Reichweite/..." (de+en)
  { name: 'X% mehr Erfolg', re: /\d+\s*%\s*(mehr\s+)?(engagement|reichweite|follower|klicks?|verkäufe?|erfolg|reach|followers|clicks?|sales|success)\b/i },
  // „verdoppelt (die) Reichweite/Follower/Klicks" / „doubles (the) reach..."
  { name: 'verdoppelt Reichweite', re: /verdoppel(t|n)?\s+(die\s+)?(reichweite|follower|klicks?)\b/i },
  { name: 'doubles the reach', re: /double[sd]?\s+(the\s+)?(reach|followers|clicks?)\b/i },
  // „garantiert mehr Reichweite/Follower/Erfolg/Wachstum"
  { name: 'garantiert mehr Reichweite', re: /garantiert\s+(mehr\s+)?(reichweite|follower|erfolg|wachstum)\b/i },
  { name: 'guaranteed more reach', re: /guaranteed\s+(more\s+)?(reach|followers|success|growth)\b/i },
  // „viral gehen" / „go viral" / „zum Hit werden" / „become a hit"
  { name: 'viral gehen', re: /viral\s+geh(en|t)\b/i },
  { name: 'go viral', re: /go(ing)?\s+viral\b/i },
  { name: 'become a hit', re: /become\s+a\s+hit\b/i },
  { name: 'zum Hit werden', re: /zum\s+hit\s+werden/i },
];

const RULE_B_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // „Wow!" / „Whoa!" als verlangte Reaktion
  { name: 'Wow!/Whoa!', re: /\b(wow|whoa)\s*!/i },
  // 😲
  { name: '😲', re: /😲/ },
  // „Da staunen alle" / „everyone is amazed"
  { name: 'Da staunen alle', re: /da\s+staunen\s+alle/i },
  { name: 'everyone is amazed', re: /everyone\s+is\s+amazed/i },
  // „ich bin/war überrascht" / „I was surprised"
  { name: 'ich bin überrascht', re: /ich\s+(bin|war)\s+überrascht/i },
  { name: 'I was surprised', re: /\bi'?m?\s+(so\s+)?(surprised|amazed|shocked)\b/i },
  // „sieht überrascht/stolz/froh/begeistert in die Kamera" / „looks surprised/proud/happy/excited into the camera"
  { name: 'sieht ... in die Kamera', re: /sieht\s+überrascht|stolz|froh|begeistert\s+in\s+die\s+kamera/i },
  { name: 'looks ... into the camera', re: /looks?\s+(surprised|proud|happy|excited)\s+into\s+the\s+camera/i },
  // „staunt überrascht"
  { name: 'staunt überrascht', re: /(staunt|staunen)\s+überrascht/i },
];

/** Diagnose v2 — deterministische Erkennung BEWIESENER Kausal-Behauptungen
 *  (probabilistische Sprachregel, Owner-Vorgabe): Formulierungen wie „der
 *  Grund ist" / „das beweist" / „liegt daran" stellen Ursachen als Tatsache
 *  dar, obwohl Kennzahlen nur WAHRSCHEINLICHE Ursachen belegen. Wird ein
 *  Muster erkannt, wird die Diagnose WEICH verworfen und mit Hinweis neu
 *  generiert (auf dem letzten Versuch wird ohnehin geliefert — der Prompt
 *  fordert die Sprachregel hart ein). Bewusst eng gefasst, um legitime
 *  Formulierungen („Das Problem ist die niedrige Wiedergabedauer" als reine
 *  Kennzahlen-Aussage) nicht fälschlich abzulehnen. */
const PROVEN_CAUSE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'der Grund ist', re: /\bder\s+grund\s+(dafür\s+)?ist\b/i },
  { name: 'die Ursache ist', re: /\bdie\s+ursache\s+(dafür\s+)?(ist|sind|war|waren)\b/i },
  { name: 'das Problem ist, dass', re: /\bdas\s+problem\s+ist[,\s]+dass\b/i },
  { name: 'liegt daran', re: /\bliegt\s+(es\s+)?daran\b/i },
  { name: 'beweist, dass', re: /\bd(as|ies|er)\s+beweist(?:,\s+)?(?:dass|es)?\b/i },
  { name: 'the reason is', re: /\bthe\s+reason\s+(?:for\s+this\s+)?is\b/i },
  { name: 'the cause is', re: /\bthe\s+cause\s+(?:of\s+this\s+)?is\b/i },
  { name: 'proves that', re: /\bproves?\s+that\b/i },
  { name: 'clearly shows that', re: /\bclearly\s+shows?\s+that\b/i },
];

/** Liefert die Namen aller zutreffenden Beweis-Sprach-Muster (leer = ok). */
function provenCauseViolations(blob: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of PROVEN_CAUSE_PATTERNS) if (re.test(blob)) hits.push('CAUSE:' + name);
  return hits;
}

/** Diagnose v2 — Themen-Tokens (deterministisch): zerlegt das Video-Thema in
 *  Inhalts-Tokens (Stoppwörter entfernt) + das ganze Thema als Teilstring. */
const TOPIC_STOPWORDS = new Set([
  'dein', 'deine', 'deinem', 'deiner', 'mein', 'meine', 'meinem', 'meiner',
  'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einer', 'einem',
  'und', 'oder', 'aber', 'wie', 'was', 'wenn', 'für', 'fuer', 'mit', 'auf',
  'von', 'zum', 'zur', 'im', 'in', 'ist', 'sind', 'nicht', 'auch', 'the', 'a',
  'an', 'and', 'or', 'for', 'with', 'about', 'of', 'to', 'in', 'on', 'is',
]);
export function topicTokens(topic: string | undefined): string[] {
  if (!topic) return [];
  const t = topic.toLowerCase().trim();
  if (!t) return [];
  const words = t.split(/[^a-zäöüß0-9]+/).filter((w) => w.length >= 3 && !TOPIC_STOPWORDS.has(w));
  const out = [...new Set(words)];
  if (t.length >= 8) out.push(t); // zusätzlich das ganze Thema (Teilstring-Check)
  return out;
}

/** Diagnose v2 — Themen-Bezug (deterministisch, weich): Wurde ein Video-Thema
 *  angegeben, muss die Diagnose das Thema WÖRTLICH widerspiegeln (mind. ein
 *  Inhalts-Token als Teilstring in newHook/optimized/rebuilt). Ohne Themen-
 *  angabe oder ohne rebuilt-Feld → true (kein Verwerfungsgrund). */
export function topicGroundedInRebuilt(topic: string | undefined, r: TikTokDiagnoseResult): boolean {
  if (!topic?.trim()) return true; // ohne Thema keine Pflicht
  const tokens = topicTokens(topic);
  if (tokens.length === 0) return true;
  const fields = [r.newHook, r.optimized];
  if (r.rebuilt) {
    fields.push(
      r.rebuilt.hook,
      r.rebuilt.voiceover,
      r.rebuilt.cta,
      r.rebuilt.timedScenes.map((s) => s.time + ' ' + s.scene + ' ' + s.text).join(' '),
    );
  }
  const blob = fields.join(' ').toLowerCase();
  return tokens.some((tok) => blob.includes(tok));
}

/** Sammelt alle relevanten Textfelder einer Idee zu einem Blob für die
 * deterministische Regel-Prüfung (kontextfrei, gilt für Idee/Hook/Szenen/
 * Einblendungen/Sprechtext/Caption/why). */
function ideaContentBlob(r: TikTokIdeaResult): string {
  return [
    r.idea, r.hook, r.scenes.join(' '), r.overlays.join(' '),
    r.spokenText, r.caption, r.why,
  ].join(' ').toLowerCase();
}

/** Analog für die Diagnose: alle Textfelder inkl. neu geschriebenem Hook und
 * optimierter Version auf Regel-A-/B-Muster prüfen. */
function diagnoseContentBlob(r: TikTokDiagnoseResult): string {
  return [
    r.biggestProblem, r.whatWorks.join(' '), r.whatToImprove.join(' '),
    r.newHook, r.optimized, r.nextTest,
    // Phase 3: auch die Längen-/Aufbau-Empfehlung wird auf Regel-A-/B-Muster
    // geprüft (z. B. „in nur X Sekunden" oder erfundene „+X%" in der Begründung).
    r.lengthRecommendation
      ? [String(r.lengthRecommendation.seconds), r.lengthRecommendation.structure, r.lengthRecommendation.reason].join(' ')
      : '',
    // Diagnose v2: die neue Video-Version wird ebenso auf Regel-A-/B-Muster
    // geprüft (Hook/Szenen/Voice-over/CTA dürfen keine verbotenen Versprechen
    // oder verordneten Reaktionen enthalten).
    r.rebuilt
      ? [r.rebuilt.hook, r.rebuilt.timedScenes.map((s) => s.time + ' ' + s.scene + ' ' + s.text).join(' '),
         r.rebuilt.voiceover, r.rebuilt.cta, String(r.rebuilt.seconds)].join(' ')
      : '',
  ].join(' ').toLowerCase();
}

/** Liefert die Namen aller zutreffenden Regel-A-/Regel-B-Muster (leer = ok). */
function ruleABViolations(blob: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of RULE_A_PATTERNS) if (re.test(blob)) hits.push('A:' + name);
  for (const { name, re } of RULE_B_PATTERNS) if (re.test(blob)) hits.push('B:' + name);
  return hits;
}

// ── Deterministische Selbstreferenz-Erkennung (todayIdea) ───────────────────
// Produktzentrierte Selbstthematisierung („Kann Growimo eine TikTok-Idee
// erstellen?", „Wir testen unser eigenes Produkt", „Wie gut ist meine Idee
// wirklich?") wird auf CODE-Ebene erkannt und wie ein Soft-Reject behandelt:
// die Idee wird verworfen und neu generiert. Nur für todayIdea — bei concept
// ist das genannte Thema der Gegenstand des Videos (dort greift die Regel
// nicht). Muster sind bewusst eng gefasst, um echte Zielgruppen-Themen
// („Kann die KI beim Texten helfen?") nicht fälschlich abzulehnen.
const SELF_REFERENCE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // DE: „Kann Growimo / unser Produkt / eine KI ...?" (Meta-Frage über das eigene Produkt)
  { name: 'kann (Growimo|unser X|eine KI)', re: /\bkann\s+(?:growimo|unser(?:\s+eigenes?)?\s+(?:produkt|app|plattform|tool|marke|software)|eine\s+ki|eine\s+ai)\b/i },
  { name: 'was kann Growimo', re: /\bwas\s+kann\s+(?:growimo|unser\s+produkt)\b/i },
  // DE: „(Wir) testen unser (eigenes) Produkt / meine eigene App"
  { name: 'testen wir unser X', re: /\b(?:testen|teste|testet|ausprobieren|austesten)\s+wir\s+(?:unser|das|unsere)/i },
  { name: 'unser X testen', re: /\bunser(?:\s+eigenes?)?\s+(?:produkt|app|plattform|tool|marke|software)\s+(?:testen|ausprobieren)\b/i },
  // DE: „Wie gut ist meine ...?" / „Lässt sich unser ...?"
  { name: 'wie gut ist meine', re: /\bwie\s+gut\s+(?:ist|sind|kann)\s+(?:mein|meine|unser|unsere)\b/i },
  { name: 'lässt sich unser', re: /\blässt\s+sich\s+(?:growimo|unser\s+produkt|unsere\s+app)\s+(?:verbessern|optimieren|nutzen)\b/i },
  // EN: „Can Growimo / our product / an AI ...?"
  { name: 'can (Growimo|our X|an AI)', re: /\bcan\s+(?:growimo|our(?:\s+own\s+)?(?:product|app|platform|tool|brand|software)|an?\s+ai)\b/i },
  { name: 'what can Growimo', re: /\bwhat\s+can\s+(?:growimo|our\s+product)\b/i },
  // EN: „(let's) test our (own) product / my own app"
  { name: "(let's) test our X", re: /\b(?:let's|lets|we)\s+(?:test|try|try\s+out)\s+our\s+(?:own\s+)?(?:product|app|platform|tool|brand|software)\b/i },
  { name: 'my own app tested', re: /\b(?:my|our)\s+own\s+(?:app|product|platform|tool|brand|software)\s*(?:tested|tried)\b/i },
  { name: 'test my own app', re: /\b(?:test|try|try\s+out)\s+(?:my|our)\s+own\s+(?:app|product|platform|tool|brand|software)\b/i },
  // EN: „How good is my ...?"
  { name: 'how good is my', re: /\bhow\s+good\s+(?:is|are|can)\s+(?:my|our)\b/i },
];
/** Liefert die Namen aller zutreffenden Selbstreferenz-Muster (leer = ok).
 *  Nur für todayIdea (siehe Aufrufer in der Retry-Schleife). */
function selfReferenceViolations(blob: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of SELF_REFERENCE_PATTERNS) if (re.test(blob)) hits.push('SELF-REF:' + name);
  return hits;
}
function buildRetryHint(lang: TikTokLang, violations: string[] = [], mode: TikTokMode = 'todayIdea'): string {
  if (mode === 'diagnose') {
    const rulePart =
      violations.length > 0
        ? lang === 'de'
          ? ` ERKANNTE REGEL-VERLETZUNGEN DER VERWORFENEN DIAGNOSE: ${violations.join(', ')} — entferne diese Wörter/Formulierungen VÖLLIG und ersetze sie durch Aussagen, die ausschließlich an den vom Nutzer gelieferten Zahlen belegt sind.`
          : ` DETECTED RULE VIOLATIONS IN THE REJECTED DIAGNOSIS: ${violations.join(', ')} — remove those words/phrases COMPLETELY and replace them with statements grounded strictly in the numbers the user provided.`
        : '';
    return lang === 'de'
      ? '\n\nHINWEIS VOM QUALITÄTS-SELBSTTEST: Die vorherige Diagnose wurde intern verworfen (sie erfand Kennzahlen, die der Nutzer nicht angegeben hat, enthielt ein unbelegtes Leistungs-/Zeit-Versprechen, eine vorgegebene künstliche Reaktion/Begeisterung oder einen zu vagen nächsten Test — oder ihre Aussagen waren nicht an den gelieferten Zahlen belegt).' + rulePart + ' Erzeuge JETZT eine deutlich bessere Diagnose: referenziere AUSSCHLIESSLICH die tatsächlich gelieferten Zahlen (nur die im Prompt gelisteten Metriken), erfinde KEINE zusätzlichen Kennzahlen/Werte/Prozente, mache in newHook/optimized/nextTest KEIN unbelegtes Versprechen (kein „in nur X Sekunden/Minuten/Tagen/Wochen", kein „+X%", kein „mehr Follower", kein „viral gehen"), verordne KEINE Reaktion/Begeisterung und nenne GENAU EINEN konkret umsetzbaren nächsten Test mit der zu beobachtenden Metrik. Liefere außerdem lengthRecommendation (seconds als Zahl, structure mit Zeitangaben, reason) MIT einer Begründung, die ausschließlich an den gelieferten und berechneten Zahlen belegt ist — kein generischer Default (z. B. „8–20 Sekunden sind am besten"), keine erfundene Zahl. Setze alle sechs selfCheck-Booleans ehrlich auf bestehen. Beziehe jede Empfehlung und die neue Video-Version (rebuilt mit hook, timedScenes MIT Zeitangaben, voiceover, cta, seconds) konkret auf das angegebene VIDEO-THEMA (falls vorhanden — nenne das Thema wörtlich; fehlt ein Thema, sage ehrlich, dass die Empfehlungen allgemeiner bleiben, und erfinde KEIN Thema). Formuliere Ursachen NUR probabilistisch („wahrscheinlich“, „kann darauf hindeuten“, „ein möglicher Grund“) — niemals als bewiesene Tatsache (nie „der Grund ist“, „das beweist“, „liegt daran“).'
      : '\n\nQUALITY SELF-CHECK NOTE: The previous diagnosis was internally rejected (it invented metrics the user did not provide, contained an unproven performance/time promise, a prescribed artificial reaction/enthusiasm or a vague next test — or its claims were not grounded in the provided numbers).' + rulePart + ' NOW produce a clearly better diagnosis: reference ONLY the numbers actually provided (the metrics listed in the prompt), invent NO additional metrics/values/percentages, make NO unproven promise in newHook/optimized/nextTest (no "in just X seconds/minutes/days/weeks", no "+X%", no "more followers", no "go viral"), prescribe NO reaction/enthusiasm and name EXACTLY ONE concrete next test with the metric to watch. Also deliver lengthRecommendation (seconds as a number, structure with time marks, reason) justified ONLY by the provided and calculated numbers — no generic default (e.g. "8-20 seconds is best"), no invented figure. Set all six selfCheck booleans truthfully to passing. Tie every recommendation and the rebuilt version (hook, timedScenes WITH time marks, voiceover, cta, seconds) concretely to the provided VIDEO TOPIC (if present — mention the topic literally; if no topic was given, say honestly that the recommendations stay more general and invent NO topic). Phrase causes ONLY probabilistically ("likely", "may point to", "a possible reason") — never as proven fact (never "the reason is", "this proves", "lies daran").';
  }
  const rulePart =
    violations.length > 0
      ? lang === 'de'
        ? ` ERKANNTE REGEL-VERLETZUNGEN DER VERWORFENEN IDEE: ${violations.join(', ')} — entferne diese Wörter/Formulierungen VÖLLIG und ersetze sie durch authentische Neugier/Möglichkeit (bei Regel A: keine konkreten unbelegten Zahlen/Zeiten/Erfolgsversprechen; bei Regel B: keine künstliche/vorgegebene Reaktion, schreibe keine Reaktion in Szenen/Einblendungen, außer sie ergibt sich echt aus dem gezeigten tatsächlichen Ergebnis).`
        : ` DETECTED RULE VIOLATIONS IN THE REJECTED IDEA: ${violations.join(', ')} — remove those words/phrases COMPLETELY and replace them with authentic curiosity/possibility (Rule A: no concrete unproven numbers/times/success promises; Rule B: no prescribed/artificial reaction — do not write any reaction into scenes/overlays unless it genuinely arises from the shown real result).`
      : '';
  const genericPart = violations.some((v) => v.startsWith('GENERIC:'))
    ? lang === 'de'
      ? ' ANTI-GENERIK: Die verworfene Idee enthielt austauschbare Standard-Werbesätze (siehe Liste oben) — ersetze sie durch Aussagen, die NUR mit diesem konkreten Produkt/Detail funktionieren. Prüfe: „Wäre diese Idee fast unverändert auf beliebige andere Produkte übertragbar?" Wenn ja: verwirf sie und entwickle eine produktspezifische Idee.'
      : ' ANTI-GENERIC: the rejected idea contained interchangeable standard advertising lines (see the list above) — replace them with lines that work ONLY with this concrete product/detail. Check: "Could this idea be used almost unchanged for arbitrary other products?" If yes: discard it and develop a product-specific one.'
    : '';
  return lang === 'de'
    ? '\n\nHINWEIS VOM QUALITÄTS-SELBSTTEST: Die vorherige Idee wurde intern verworfen (zu austauschbar / zu werblich / ohne echte Markenfakten oder Challenge-Bezug — oder weil sie ein erfundenes Testimonial / eine zitierte Person / erfundenes Nutzerfeedback enthielt, das nicht im MARKENKONTEXT belegt ist, ODER weil sie ein unbelegtes konkretes Leistungs-/Zeit-Versprechen oder eine vorgegebene künstliche Reaktion/Begeisterung enthielt).' + rulePart + genericPart + ' Erzeuge JETZT eine deutlich bessere, neue Idee: bleibe in der vorgegebenen Content-Richtung und baue sie aus der PERSPEKTIVE DER ZIELGRUPPE (was hilft oder begeistert die Zielgruppe?) — NICHT aus der Produktperspektive. Verboten sind produktzentrierte Selbstreferenz-Ideen („Kann Growimo eine TikTok-Idee erstellen?", „Wir testen unser eigenes Produkt", „Wie gut ist meine TikTok-Idee wirklich?"); das Produkt darf höchstens als Beiwerk/Beispiel vorkommen, niemals als Thema. Erfinde keinerlei Nutzer/Tester/Testimonials/Zitate; zeige stattdessen einen echten, ehrlichen Prozess aus der Zielgruppen-Perspektive. Mache KEINERLEI unbelegtes konkretes Leistungs-/Zeit-/Ergebnis-Versprechen (kein „in nur X Sekunden/Minuten/Tagen/Wochen", kein „+X%", kein „verdoppelt die Reichweite", kein „viral gehen") und KEINE vorgegebene künstliche Reaktion/Begeisterung (kein „Wow!", kein „Da staunen alle", keine aufgesetzte Überraschung — eine Reaktion nur, wenn sie das gezeigte tatsächliche Ergebnis echt erzeugt, sonst ganz weglassen). Setze alle sieben selfCheck-Booleans ehrlich auf bestehen.'
    : '\n\nQUALITY SELF-CHECK NOTE: The previous idea was internally rejected (too interchangeable / too ad-like / without real brand facts or challenge tie-in — or because it contained an invented testimonial / quoted person / invented user feedback not backed by the BRAND CONTEXT, OR because it contained an unproven concrete performance/time promise or a prescribed artificial reaction/enthusiasm).' + rulePart + genericPart + ' NOW produce a clearly better, NEW idea: stay in the given content direction and build it from the TARGET AUDIENCE\'s perspective (what helps or excites them?) — NOT from the product perspective. Product-centric self-referential ideas are forbidden ("Can Growimo create a TikTok idea?", "We test our own product", "How good is my TikTok idea really?"); the product may appear at most as a supporting element/example, never as the topic. Do not invent any users/testers/testimonials/quotes; instead show a real, honest process from the audience\'s perspective. Make NO unproven concrete performance/time/result promise (no "in just X seconds/minutes/days/weeks", no "+X%", no "doubles your reach", no "go viral") and NO prescribed artificial reaction/enthusiasm (no "Wow!", no "everyone is amazed", no staged surprise — a reaction only if genuinely produced by the shown real result, otherwise omit it entirely). Set all seven selfCheck booleans truthfully to passing.';
}

// ── Phase 2 — Ergebnisstruktur: maximal 5 Hashtags (Owner-Vorgabe) ──────────
// Hart im Parser durchgesetzt (nicht nur im Prompt verlangt): „jedes Ergebnis
// enthält maximal 5 passende Hashtags" gilt damit deterministisch für JEDE
// Ausgabe, unabhängig davon, was das Modell liefert.
export const MAX_TIKTOK_HASHTAGS = 5;

// ── Phase 2 — Platzhalter-Verbot (deterministisch) ──────────────────────────
// Generische Ausfüll-Anweisungen („[Trendigen Sound hier einfügen]",
// „Sound: <beliebig>", „TODO", „Platzhalter") sind KEIN Ergebnis. Diese Muster
// erkennen sie in allen Textfeldern; die Liste ist bewusst eng gefasst, damit
// echte Inhalte (z. B. „Sound: leiser Klavier-Loop, 70 BPM") NICHT matchen.
export const PLACEHOLDER_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'klammer-anweisung', re: /\[[^\]]{0,120}(?:einfügen|einsetzen|hier|dein|deine|your|insert|add|sound|musik|music|effekt|effect|filter|trend|beliebig|irgendein|optional|platzhalter|placeholder|todo|tbd)[^\]]{0,120}\]/i },
  { name: 'klammer-punkte', re: /\[(?:\s*\.{2,}\s*|\s*…\s*)\]/ },
  { name: 'spitzklammer-anweisung', re: /<[^>]{0,80}(?:sound|musik|music|einfügen|insert|dein|your|text|name|link|beliebig)[^>]{0,80}>/i },
  { name: 'hier-einfuegen', re: /\b(?:hier|here)\s+(?:einfügen|einsetzen|insert|hineinfügen)\b/i },
  { name: 'einfuegen-hier', re: /\b(?:einfügen|einsetzen|insert|add)\s+(?:hier|here)\b/i },
  { name: 'dein-x-hier', re: /\b(?:dein(?:e|en)?|your)\s+(?:sound|musik|music|song|link|hashtags?|effekt|effect)\s+(?:hier|here)\b/i },
  { name: 'beliebiger-sound', re: /\b(?:beliebig(?:er|en|es)?|irgendein(?:e|en)?|some|any)\s+(?:trend[-\s]?)?(?:sound|musik|music|song|effekt|effect|filter)\w*/i },
  { name: 'sound-generisch', re: /\b(?:sound|musik|music|song|effekt|effect)\s*[:=]\s*(?:beliebig\w*|irgendein\w*|frei\w*|any\b|some\b)/i },
  { name: 'todo-tbd', re: /\b(?:TODO|TBD|FIXME|XXX+)\b/ },
  { name: 'platzhalter-wort', re: /\b(?:platzhalter|placeholder)\b/i },
  { name: 'sound-klammer-wahl', re: /\(\s*(?:sound|musik|music|song|effekt|effect)\s*[:=]?\s*(?:beliebig|frei|wählen|wähle|choose|any)[^)]{0,40}\)/i },
];

/** Textfelder EINER Idee als Prüf-Blob (inkl. timedScenes/imageIdeas) — nur für
 *  die Platzhalter-Prüfung (die Regel-A/B-Prüfung nutzt weiterhin
 *  ideaContentBlob mit unverändertem Umfang). */
export function ideaPlaceholderBlob(r: TikTokIdeaResult): string {
  const parts: string[] = [
    r.idea, r.hook, r.scrollStop ?? '', r.tension ?? '', r.length, r.format ?? '',
    r.title ?? '', r.scenes.join(' '), r.overlays.join(' '), r.spokenText,
    r.caption, r.cta, r.why,
  ];
  for (const s of r.timedScenes ?? []) parts.push(s.time, s.scene, s.text);
  for (const i of r.imageIdeas ?? []) parts.push(i.description, i.studioPrompt);
  return parts.join(' ').toLowerCase();
}

/** Liefert die Namen aller gefundenen Platzhalter-Muster (leer = sauber). */
export function placeholderViolations(blob: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of PLACEHOLDER_PATTERNS) if (re.test(blob)) hits.push('PLACEHOLDER:' + name);
  return hits;
}

/** Entfernt Platzhalter-Reste aus einem einzelnen Textfeld (idempotent). */
const PLACEHOLDER_STRIP_PATTERNS: RegExp[] = [
  /\[[^\]]{0,120}(?:einfügen|einsetzen|hier|dein|deine|your|insert|add|sound|musik|music|effekt|effect|filter|trend|beliebig|irgendein|optional|platzhalter|placeholder|todo|tbd)[^\]]{0,120}\]/gi,
  /\[(?:\s*\.{2,}\s*|\s*…\s*)\]/g,
  /<[^>]{0,80}(?:sound|musik|music|einfügen|insert|dein|your|text|name|link|beliebig)[^>]{0,80}>/gi,
  /\((?:hier\s+)?(?:einfügen|einsetzen|insert|add)[^)]{0,60}\)/gi,
  /\b(?:hier|here)\s+(?:einfügen|einsetzen|insert|hineinfügen)\b/gi,
  /\b(?:sound|musik|music|song|effekt|effect)\s*[:=]\s*(?:beliebig\w*|irgendein\w*|frei\w*|any\b|some\b)[^.;!?\n]{0,40}/gi,
  /\b(?:beliebig(?:er|en|es)?|irgendein(?:e|en)?|some|any)\s+(?:trend[-\s]?)?(?:sound|musik|music|song|effekt|effect|filter)\w*/gi,
  /\b(?:TODO|TBD|FIXME|XXX+)\b/g,
  /\b(?:Platzhalter|Placeholder)\b/gi,
];
function stripPlaceholderText(s: string): string {
  let out = s;
  for (const re of PLACEHOLDER_STRIP_PATTERNS) out = out.replace(re, ' ');
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/** Phase 2 — Platzhalter-Endreinigung: entfernt generische Ausfüll-Anweisungen
 *  deterministisch aus dem akzeptierten Ergebnis („lieber den Punkt weglassen
 *  als eine Lücke hinterlassen"). Gibt dasselbe Objekt zurück, wenn nichts zu
 *  tun war (Identitäts-Vergleich bleibt dadurch aussagekräftig). */
export function placeholderFreeResult(r: TikTokIdeaResult): TikTokIdeaResult {
  const clean = stripPlaceholderText;
  const cleanArr = (a: string[]) => a.map(clean).filter((x) => x.trim() !== '');
  const out: TikTokIdeaResult = {
    ...r,
    idea: clean(r.idea),
    hook: clean(r.hook),
    length: clean(r.length),
    scenes: cleanArr(r.scenes),
    overlays: cleanArr(r.overlays),
    spokenText: clean(r.spokenText),
    caption: clean(r.caption),
    cta: clean(r.cta),
    why: clean(r.why),
  };
  if (r.scrollStop !== undefined) out.scrollStop = clean(r.scrollStop);
  if (r.tension !== undefined) out.tension = clean(r.tension);
  if (r.format !== undefined) out.format = clean(r.format);
  if (r.title !== undefined) out.title = clean(r.title);
  if (r.timedScenes !== undefined) {
    out.timedScenes = r.timedScenes.map((s) => ({ time: s.time, scene: clean(s.scene), text: clean(s.text) }));
  }
  if (r.imageIdeas !== undefined) {
    out.imageIdeas = r.imageIdeas
      .map((i) => ({ description: clean(i.description), studioPrompt: clean(i.studioPrompt) }))
      .filter((i) => i.description !== '' || i.studioPrompt !== '');
  }
  return JSON.stringify(out) === JSON.stringify(r) ? r : out;
}

// ── Phase 5g (Owner-Auftrag 2026-09-23) — ANTI-GENERIK (deterministisch) ────
// Die Owner-Kriterien 3 und 4 verlangen, dass austauschbare Standard-
// Werbeaussagen weder im Prompt noch im Ergebnis landen. Die Muster sind
// deckungsgleich mit den im Prompt (ideaSharpeningMandate) verbotenen
// Beispielen und enthalten die beiden vom Owner wörtlich beanstandeten Sätze:
// „Finde deinen Stil" und „Der Unterschied ist sofort sichtbar".
// Bewusst eng gefasst (ganze Slogans statt einzelner Wörter), damit echte
// produktspezifische Inhalte NICHT fälschlich abgelehnt werden.
export const GENERIC_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'finde-deinen-stil', re: /\bfind(?:e|et|en)?\s+deinen\s+stil\b/i },
  { name: 'find-your-style', re: /\bfind\s+your\s+(?:own\s+)?style\b/i },
  { name: 'unterschied-sofort-sichtbar', re: /der\s+unterschied\s+ist\s+(?:sofort|direkt|gleich|auf\s+den\s+ersten\s+blick)\s+sichtbar/i },
  { name: 'difference-immediately-visible', re: /the\s+difference\s+is\s+(?:immediately|instantly|clearly)\s+visible/i },
  { name: 'entdecke-dein-potenzial', re: /\bentdeck(?:e|t|en)?\s+dein\s+(?:volles\s+)?potenzial\b/i },
  { name: 'discover-your-potential', re: /\bdiscover\s+your\s+(?:full\s+)?potential\b/i },
  { name: 'das-beste-fuer-dich', re: /\bdas\s+beste\s+(?:für|fuer)\s+dich\b/i },
  { name: 'the-best-for-you', re: /\bthe\s+best\s+for\s+you\b/i },
  { name: 'hebe-dich-ab', re: /\bheb(?:e|t|en)?\s+dich\s+(?:von\s+der\s+masse\s+)?ab\b/i },
  { name: 'stand-out-from-the-crowd', re: /\bstand\s+out\s+from\s+the\s+crowd\b/i },
];

/** Liefert die Namen aller zutreffenden Anti-Generik-Muster (leer = sauber). */
export function genericViolations(blob: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of GENERIC_PATTERNS) if (re.test(blob)) hits.push('GENERIC:' + name);
  return hits;
}

/** Entfernt generische Slogans aus einem einzelnen Textfeld (idempotent). */
const GENERIC_STRIP_PATTERNS: RegExp[] = [
  /\bfind(?:e|et|en)?\s+deinen\s+stil\b/gi,
  /\bfind\s+your\s+(?:own\s+)?style\b/gi,
  /der\s+unterschied\s+ist\s+(?:sofort|direkt|gleich|auf\s+den\s+ersten\s+blick)\s+sichtbar/gi,
  /the\s+difference\s+is\s+(?:immediately|instantly|clearly)\s+visible/gi,
  /\bentdeck(?:e|t|en)?\s+dein\s+(?:volles\s+)?potenzial\b/gi,
  /\bdiscover\s+your\s+(?:full\s+)?potential\b/gi,
  /\bdas\s+beste\s+(?:für|fuer)\s+dich\b/gi,
  /\bthe\s+best\s+for\s+you\b/gi,
  /\bheb(?:e|t|en)?\s+dich\s+(?:von\s+der\s+masse\s+)?ab\b/gi,
  /\bstand\s+out\s+from\s+the\s+crowd\b/gi,
];
function stripGenericText(s: string): string {
  let out = s;
  let hit = false;
  for (const re of GENERIC_STRIP_PATTERNS) {
    const next = out.replace(re, ' ');
    if (next !== out) hit = true;
    out = next;
  }
  // NICHTS gefunden => Feld unverändert zurückgeben (kein Trimmen/Normalisieren):
  // sonst würde jedes saubere Feld „angefasst" und die Identitäts-/Idempotenz-
  // Garantie (genericFreeResult gibt bei sauberem Ergebnis DASSELBE Objekt
  // zurück) wäre wertlos.
  if (!hit) return s;
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    // Übrig gebliebene Satzzeichen/Bindestriche am Feldrand (z. B. „: die Tasse",
    // nachdem der Slogan am Satzanfang entfernt wurde) => kein kaputter Feldanfang.
    .replace(/^[\s:;,.\u2013\u2014-]+/, '')
    .replace(/[\s:;,.\u2013\u2014-]+$/, '')
    .trim();
}

/** Phase 5g — Anti-Generik-Endreinigung (letzter Versuch): entfernt generische
 *  Slogans deterministisch aus dem akzeptierten Ergebnis (Pendant zu
 *  placeholderFreeResult). Die Regel „Ein verbotener Satz verlässt die Engine
 *  NIE" hat Vorrang vor Kosmetik: bleibt nach dem Entfernen nichts übrig, ist
 *  das Feld leer statt wieder generisch. */
export function genericFreeResult(r: TikTokIdeaResult): TikTokIdeaResult {
  // Bewusst OHNE „lieber Original als leer"-Rückfall (anders als in einem ersten
  // Entwurf): ein verbotener Slogan darf das Ergebnis NIE erreichen — auch nicht
  // als Ganzfeld-Füllung wie hook = „Finde deinen Stil". Bleibt nach dem
  // Entfernen nichts übrig, ist das Feld ehrlich leer (die Retry-Schleife hat
  // vorher bis zu MAX_TIKTOK_ATTEMPTS Versuche unternommen, das zu vermeiden).
  const clean = stripGenericText;
  const cleanArr = (a: string[]): string[] => a.map(clean).filter((x) => x.trim() !== '');
  const out: TikTokIdeaResult = {
    ...r,
    idea: clean(r.idea),
    hook: clean(r.hook),
    length: clean(r.length),
    scenes: cleanArr(r.scenes),
    overlays: cleanArr(r.overlays),
    spokenText: clean(r.spokenText),
    caption: clean(r.caption),
    cta: clean(r.cta),
    why: clean(r.why),
  };
  if (r.scrollStop !== undefined) out.scrollStop = clean(r.scrollStop);
  if (r.tension !== undefined) out.tension = clean(r.tension);
  if (r.format !== undefined) out.format = clean(r.format);
  if (r.title !== undefined) out.title = clean(r.title);
  if (r.timedScenes !== undefined) {
    out.timedScenes = r.timedScenes.map((s) => ({
      time: s.time,
      scene: clean(s.scene),
      text: clean(s.text),
    })).filter((s) => s.scene.trim() !== '' || s.text.trim() !== '');
  }
  if (r.imageIdeas !== undefined) {
    out.imageIdeas = r.imageIdeas
      .map((i) => ({ description: clean(i.description), studioPrompt: clean(i.studioPrompt) }))
      .filter((i) => i.description.trim() !== '' || i.studioPrompt.trim() !== '');
  }
  return JSON.stringify(out) === JSON.stringify(r) ? r : out;
}

// ── Phase 2 — Vollständigkeitsprüfung („Vollständiges Konzept") ─────────────
/** Liefert die Liste der fehlenden Phase-2-Konzeptfelder (leer = vollständig).
 *  Nur für die Idee-Modi (todayIdea/concept) relevant; diagnose prüft nicht. */
export function conceptCompleteness(r: TikTokIdeaResult): string[] {
  const missing: string[] = [];
  // Phase 2 — Hook ist der Kern der Ergebnisstruktur (1–2 Sek., Scroll-Stop).
  if (!r.hook.trim()) missing.push('hook');
  if (!r.format) missing.push('format');
  if (!r.title) missing.push('title');
  if (!r.timedScenes || r.timedScenes.length === 0) missing.push('timedScenes');
  else {
    if (r.timedScenes.some((s) => !s.time || !s.scene)) missing.push('timedScenes (vollständig)');
    // Phase 2 — der Szenenplan muss bei Sekunde 0 beginnen (lückenlos ab 0s).
    if (!timedSceneStartsAtZero(r.timedScenes[0].time)) missing.push('timedScenes (Start bei 0s)');
  }
  // Phase 2 — Hashtags: mindestens einer; die Obergrenze (max. 5) erzwingt der
  // Parser deterministisch (MAX_TIKTOK_HASHTAGS), nicht ein Retry.
  if (r.hashtags.length === 0) missing.push('hashtags');
  if (!r.imageIdeas || r.imageIdeas.length === 0) missing.push('imageIdeas');
  else if (r.imageIdeas.some((i) => !i.studioPrompt)) missing.push('imageIdeas (studioPrompt)');
  return missing;
}

/** Phase 2 — beginnt eine Zeitmarke bei Sekunde 0? („0-2s", „0–2s", „0s") */
export function timedSceneStartsAtZero(time: string): boolean {
  return /^\s*0\s*(?:s\b|[-–—]|$)/i.test(time ?? '');
}

/** Phase 2 — Retry-Hinweis für unvollständige Konzepte: nennt explizit die
 *  fehlenden Felder, damit das Modell das komplette Schema nachliefert. */
function buildCompletenessHint(lang: TikTokLang, missing: string[]): string {
  if (missing.length === 0) return '';
  return lang === 'de'
    ? `\n\nVOLLSTÄNDIGKEITSHINWEIS: Die vorherige Antwort war UNVOLLSTÄNDIG — diese PFLICHTFELDER des Konzepts fehlten: ${missing.join(', ')}. Liefere jetzt das KOMPLETTE Konzept mit ALLEN Feldern (idea, hook, scrollStop, length, format, title, tension, timedScenes LÜCKENLOS MIT SEKUNDEN ab 0s, scenes, overlays, spokenText, caption, max. 5 Hashtags, cta, why, imageIdeas mit studioPrompt). KEINE Platzhalter, keine Klammer-Anweisungen — konkrete Angaben oder den Punkt weglassen.`
    : `\n\nCOMPLETENESS NOTE: The previous answer was INCOMPLETE — these REQUIRED concept fields were missing: ${missing.join(', ')}. NOW deliver the COMPLETE concept with ALL fields (idea, hook, scrollStop, length, format, title, tension, timedScenes GAP-FREE WITH SECONDS from 0s, scenes, overlays, spokenText, caption, max. 5 hashtags, cta, why, imageIdeas with studioPrompt). NO placeholders, no bracketed instructions — concrete information or leave the point out.`;
}

// ── Phase 4 — Post-Generation-Guard auf TikTok-Outputs (metric-guard) ────────
// Entscheidung (dokumentiert): Die vorhandene sanitizeUnbackedMetrics()-Guard
// (src/ai/metric-guard.ts) ist TEXT-basiert (Signatur: text, userContext →
// bereinigter Text) und kann nicht direkt auf das strukturierte TikTok-Ergebnis
// angewendet werden. Deshalb kommt ein TikTok-Pendant sanitizeTikTokResult()
// zum Einsatz, das die Guard MIT DERSELBEN EHRLICHKEITS-ABSICHT rekursiv auf
// jedes Textfeld des Ergebnisses anwendet und zwei TikTok-spezifische Lücken
// schließt: (1) „nackte“ Wachstums-/Erfolgsbehauptungen wie „10k Follower
// gewachsen“, die KEINE %/×/Raten-Muster enthalten (die Guard-RegEx greift dort
// nicht) — hier erfolgt eine eigene, gleichartige LLM-Neutralisierung mit
// identischer Schutzlogik für Nutzerzahlen; (2) alle Nutzerzahlen (metrics,
// brandContext, projectContext, biz/topic/goal/audience) gelten als belegt und
// werden nie angetastet. Ein Feld ohne kennzahlenartiges Muster wird per
// Fast-Path unverändert gelassen (null Latenz, null LLM-Kosten). Zusätzlich
// zum Pendant wird die Guard in der Retry-Schleife auf dem AKZEPTIERTEN
// Ergebnis jedes Versuchs angewendet (alle Modi). Wirft nie.
const NAKED_CLAIM_PATTERNS: RegExp[] = [
  // „10k Follower gewachsen“ / „1.500 Views“ / „250 Reichweite“ / „10k followers“
  /\b\d{1,3}(?:[.,]\d+)?\s*[kK]?\s*(followers?|reichweite|aufrufe|views?|klicks?|verkäufe?|sales|downloads?|saves)\b/i,
  // „50% mehr Engagement“ ohne Nutzerbeleg (Ergänzung zur Guard: nur mit Qualifier,
  // damit belegte Watch-Raten wie „38,1% Watch-Rate“ nicht als Claim zählen)
  /\b\d{1,3}(?:[.,]\d+)?\s*%\s*(mehr|öfter|häufiger|schneller|higher|more|often|faster)\b/i,
];
/** Frische /g-Instanz (matchAll braucht global UND LastIndex 0 — shared /g-RegEx
 *  würde durch vorherige test()/exec()-Aufrufe verschmutzt). */
function cloneGlobal(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
}

function hasNakedClaim(text: string): boolean {
  if (!text) return false;
  for (const re of NAKED_CLAIM_PATTERNS) {
    const r = new RegExp(re.source, re.flags);
    if (r.test(text)) return true;
  }
  return false;
}

/** Normalisiert eine Zahl für den Beleg-Vergleich (Trenner weg, k/m expandiert). */
function normalizeNumberToken(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s*%\s*$/, '').trim();
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*([km])?$/);
  if (!m) return s.replace(/[^0-9]/g, '');
  let num = m[1]!.replace(/[.,]/g, '');
  if (m[2] === 'k') num = num + '000';
  if (m[2] === 'm') num = num + '000000';
  return num;
}

/** Enthält der Text eine nackte Kennzahl-Behauptung, deren Zahl NICHT in der
 *  Nutzervorgabe steht (normalisierter Präsenz-Vergleich)? */
function hasUnbackedNakedNumber(text: string, userContext: string): boolean {
  const normalizedCtx = userContext.replace(/[^0-9]/g, '');
  for (const re of NAKED_CLAIM_PATTERNS) {
    for (const m of text.matchAll(cloneGlobal(re))) {
      const numStr = m[0].match(/\d{1,3}(?:[.,]\d+)?/)?.[0] ?? '';
      if (numStr && !normalizedCtx.includes(normalizeNumberToken(numStr))) return true;
    }
  }
  return false;
}

/** Neutralisiert nackte (nicht-%, nicht-×) Kennzahlen-Claims via einem kompakten
 *  GPT-4o-Aufruf — gleiche Absicht/Form wie die Guard: NUR die unbelegten Zahlen
 *  werden entfernt, alles andere bleibt wortgleich. Wirft nie (Original bei Fehler). */
async function neutralizeNakedClaims(text: string, userContext: string): Promise<string> {
  const unbackedTokens: string[] = [];
  const normalizedCtx = userContext.replace(/[^0-9]/g, '');
  for (const re of NAKED_CLAIM_PATTERNS) {
    for (const m of text.matchAll(cloneGlobal(re))) {
      const full = m[0].trim();
      const numStr = m[0].match(/\d{1,3}(?:[.,]\d+)?/)?.[0] ?? '';
      if (numStr && !normalizedCtx.includes(normalizeNumberToken(numStr)) && !unbackedTokens.includes(full)) {
        unbackedTokens.push(full);
      }
    }
  }
  if (unbackedTokens.length === 0) return text;
  try {
    const openai = await import('openai').then((mod) => mod.default);
    const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      messages: [
        { role: 'system', content: 'Du neutralisierst Aussagen. Entferne NUR unbelegte Kennzahlen-Claims und ändere nichts anderes.' },
        {
          role: 'user',
          content:
            'Du neutralisierst Aussagen. Entferne NUR unbelegte Kennzahlen-Claims und ändere nichts anderes.\n' +
            `Entferne bzw. neutralisiere AUSSCHLIESSLICH diese unbelegten Kennzahlen im Text (nimm die Zahl aus dem Satz und formuliere ohne sie weiter): ${unbackedTokens.join(', ')}. ` +
            'Alle anderen Zahlen bleiben EXAKT unverändert. Wenn ein Satz NUR aus der Kennzahl bestünde, streiche ihn. Gib NUR den bereinigten Text zurück.\n' +
            `Nutzervorgaben (belegt, NICHT entfernen):\n---\n${userContext.slice(0, 3000)}\n---\n\nZu bereinigender Text, Antworte mit dem bereinigten Text (und nur dem):\n${text}`,
        },
      ],
    });
    const cleaned = completion.choices[0]?.message?.content ?? text;
    return cleaned.trim() && cleaned !== text ? cleaned : text;
  } catch {
    return text;
  }
}

/** Reinigt ein einzelnes Textfeld: erst die vorhandene Guard (%, ×, Raten),
 *  danach (falls noch nackte Claims übrig sind) die TikTok-spezifische Schicht. */
async function cleanTikTokTextField(text: string, userContext: string): Promise<string> {
  if (!text) return text;
  const hasMetric = hasMetricPattern(text);
  const hasNaked = hasNakedClaim(text);
  if (!hasMetric && !hasNaked) return text;
  let out = text;
  if (hasMetric) {
    const guarded = await sanitizeUnbackedMetrics(out, userContext);
    out = guarded.text;
  }
  if (hasNakedClaim(out) && hasUnbackedNakedNumber(out, userContext)) {
    out = await neutralizeNakedClaims(out, userContext);
  }
  return out;
}

/** Rekursiver Feld-Walk über das strukturierte TikTok-Ergebnis. */
async function sanitizeTikTokValue(
  value: unknown,
  userContext: string,
  changedRef: { v: boolean },
): Promise<unknown> {
  if (typeof value === 'string') {
    const cleaned = await cleanTikTokTextField(value, userContext);
    if (cleaned !== value) changedRef.v = true;
    return cleaned;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(await sanitizeTikTokValue(item, userContext, changedRef));
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await sanitizeTikTokValue(v, userContext, changedRef);
    }
    return out;
  }
  return value;
}

/** TikTok-Pendant zur metric-guard: wendet die Guard (bzw. die TikTok-Erweiterung)
 *  auf alle Textfelder eines TikTok-Ergebnisses an (alle Modi). Wirft nie —
 *  bei jedem Fehler bleibt das Original erhalten. Wird in der Retry-Schleife
 *  auf dem akzeptierten Ergebnis jedes Versuchs angewendet. */
export async function sanitizeTikTokResult(
  result: TikTokResult,
  userContext: string,
): Promise<TikTokResult> {
  try {
    const changedRef = { v: false };
    const cleaned = (await sanitizeTikTokValue(result, userContext, changedRef)) as TikTokResult;
    if (!cleaned || typeof cleaned !== 'object' || !('mode' in cleaned)) return result;
    return changedRef.v ? cleaned : result;
  } catch {
    return result;
  }
}

/** Baut die belegte Nutzer-Basis für die Guard: alle Zahlen/Fakten, die der
 *  Nutzer (oder sein Projekt/Markenprofil) geliefert hat → werden nie entfernt.
 *  Enthält die Retentions-Werte in beiden Zahlenformaten (38,1 / 38.1, 2.500/2,500). */
function buildSanitizeUserContext(input: TikTokInput): string {
  const parts: string[] = [];
  const push = (v: string | undefined) => {
    if (v && v.trim()) parts.push(v.trim());
  };
  push(input.biz);
  push(input.brandContext);
  push(input.topic);
  // Diagnose v2: Video-Thema/-Hook sind Nutzerfakten → Zahlen darin gelten als belegt.
  push(input.videoTopic);
  push(input.videoHook);
  push(input.goal);
  push(input.audience);
  if (input.projectContext) {
    push(input.projectContext.title);
    push(input.projectContext.productIdea);
    push(input.projectContext.brief);
  }
  const m = input.metrics;
  if (m) {
    const nums: string[] = ['metrics:'];
    const maybe = (label: string, v: number | undefined) => {
      if (v !== undefined && Number.isFinite(v)) {
        nums.push(label + v, label + fmtInt(v, true), label + fmtInt(v, false));
      }
    };
    maybe('views=', m.views);
    maybe('likes=', m.likes);
    maybe('comments=', m.comments);
    maybe('shares=', m.shares);
    maybe('avgWatch=', m.avgWatch);
    maybe('profileVisits=', m.profileVisits);
    if (m.length) nums.push('length=' + m.length);
    const ret = computeRetention(m);
    if (ret) {
      nums.push(
        'watchRate=' + fmtPct(ret.watchRatePct, true)
          + ' ' + fmtPct(ret.watchRatePct, false)
          + ' ' + String(ret.watchRatePct)
          + ' ' + String(ret.watchRatePct).replace('.', ','),
        'lengthS=' + ret.lengthSeconds,
        'totalWatch=' + ret.totalWatchSeconds
          + ' ' + fmtInt(ret.totalWatchSeconds, true)
          + ' ' + fmtInt(ret.totalWatchSeconds, false),
      );
    }
    parts.push(nums.join(' '));
  }
  return parts.join('\n');
}

// ── Hauptfunktion ────────────────────────────────────────────────────────────
/**
 * Erzeugt ein strukturiertes TikTok-Ergebnis für einen der drei Modi.
 * Wirft bei fehlendem Key, Netzwerkfehler oder nicht validierbarem JSON.
 * `lang` steuert die Ausgabesprache (de/en) — identisches JSON-Schema.
 * todayIdea durchläuft einen internen Qualitäts-Selbsttest mit Retry.
 */
export async function generateTikTok(
  input: TikTokInput,
  lang: TikTokLang = 'de',
  signal?: AbortSignal,
): Promise<TikTokResult> {
  // Phase 5 — Server-Timeout/Client-Abbruch: bereits abgebrochen? Dann sofort
  // sauber beenden (kein LLM-Call, kein Retry) — ehrliche Meldung statt Hänger.
  if (signal?.aborted) throw tiktokTimeoutError(lang);
  // Phase 3 — ehrlicher „zu wenig Daten"-Zustand: fehlen views/length/avgWatch
  // (oder ist die Länge nicht parsebar), ratet Growimo NICHT und ruft KEIN LLM:
  // deterministische Teil-Diagnose statt erfundener Länge/Zahlen.
  if (input.mode === 'diagnose') {
    const gaps = diagnoseRetentionGaps(input.metrics);
    if (gaps.length > 0) return buildDiagnoseDataGapResult(gaps, lang);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      lang === 'de'
        ? 'TikTok-Engine nicht konfiguriert (OPENAI_API_KEY fehlt).'
        : 'TikTok engine not configured (OPENAI_API_KEY missing).',
    );
  }
  const client = new OpenAI({ apiKey });
  const system = pickSystemPrompt(input.mode, lang);
  let lastViolations: string[] = [];
  let lastMissing: string[] = [];

  for (let attempt = 1; attempt <= MAX_TIKTOK_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw tiktokTimeoutError(lang);
    const user =
      attempt === 1
        ? buildUserPrompt(input, lang)
        : buildUserPrompt(input, lang)
          + buildRetryHint(lang, lastViolations, input.mode)
          + buildCompletenessHint(lang, lastMissing);

    let response;
    try {
      response = await client.chat.completions.create(
        {
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.7,
          max_tokens: 2400, // Phase 2: größeres Schema (format/timedScenes/title/imageIdeas) → Kopfplatz
          response_format: { type: 'json_object' },
        },
        // Phase 5 — AbortSignal als RequestOption: Client-Abbruch/Server-Timeout
        // bricht den laufenden LLM-Call tatsächlich ab (OpenAI SDK ehrt es).
        { signal },
      );
    } catch (err) {
      // Phase 5 — Abbruch wird in die konsistente, ehrliche Timeout-Meldung
      // übersetzt (statt kryptischem SDK-Abort-Fehler); alles andere unverändert.
      if (signal?.aborted) throw tiktokTimeoutError(lang);
      throw err;
    }
    const text = response.choices[0]?.message?.content;
    if (!text) {
      if (attempt === MAX_TIKTOK_ATTEMPTS) {
        throw new Error('TikTok-Engine lieferte eine leere Antwort.');
      }
      continue;
    }

    const result = parseResult(input.mode, text);
    if (!result) {
      if (attempt === MAX_TIKTOK_ATTEMPTS) {
        throw new Error(
          lang === 'de'
            ? 'Die TikTok-Antwort konnte nicht gelesen werden. Bitte erneut versuchen.'
            : 'Could not read the TikTok response. Please try again.',
        );
      }
      continue; // Parse-Fehler → erneut versuchen
    }

    // Phase 3 — Typ-Verengung: der dataGap-Zustand wurde bereits VOR dem
    // LLM-Call abgefangen; ein dataGap-Ergebnis kann hier nicht auftreten.
    if (isDiagnoseDataGap(result)) return result;
    if (result.mode === 'diagnose') {
      // Diagnose v2 — Video-Thema-Echo-Fallback: gibt das LLM das eingegebene
      // Thema nicht wörtlich zurück (alte Outputs/Modell-Nachlässigkeit), setzt
      // die Engine es deterministisch aus dem Input — das UI zeigt dadurch
      // immer den echten Themen-Bezug und nie ein erfundenes Thema.
      if (!result.videoTopic && input.videoTopic?.trim()) {
        result.videoTopic = input.videoTopic.trim();
      }
    }

    // Qualitäts-Selbsttest + deterministische Regel-A+B-Prüfung auf Code-Ebene
    // (unabhängig davon, ob das Modell die Flags ehrlich gemeldet hat) —
    // angewendet auf ALLE drei Modi (todayIdea / concept / diagnose).
    if (result.mode === 'diagnose') {
      const blob = diagnoseContentBlob(result);
      const violations = ruleABViolations(blob);
      // Diagnose v2 — probabilistische Sprachregel + Themen-Bezug: weiche
      // Verstöße (Ursache als bewiesene Tatsache formuliert / angegebenes
      // Video-Thema ignoriert) werden separat behandelt → Retry mit Hinweis;
      // auf dem letzten Versuch wird trotzdem geliefert (kein Fehler statt
      // Diagnose — der Prompt fordert beide Regeln bereits hart ein).
      const softV = [
        ...provenCauseViolations(blob),
        ...(topicGroundedInRebuilt(input.videoTopic, result) ? [] : ['topic-not-grounded']),
      ];
      lastViolations = [...violations, ...softV];
      const scRejected = result.selfCheck ? diagnoseSelfCheckRejected(result.selfCheck) : false;
      if (scRejected || violations.length > 0) {
        const reason = scRejected ? 'self-check' : 'Rule A/B';
        console.log(
          `[tiktok] diagnose ${reason} REJECTED (attempt ${attempt}) — regenerating` +
            (result.selfCheck ? ` selfCheck=${JSON.stringify(result.selfCheck)}` : '') +
            (lastViolations.length > 0 ? ` ruleA/B+selfRef=${lastViolations.join('|')}` : ''),
        );
        if (attempt < MAX_TIKTOK_ATTEMPTS) continue;
        // Fail closed: NIE eine Diagnose ausgeben, die Kennzahlen erfindet,
        // verbotene Versprechen enthält oder Reaktionen verordnet.
        throw new Error(
          lang === 'de'
            ? 'Die TikTok-Diagnose konnte nach mehrmaligem Versuch nicht ohne erfundene Kennzahlen, verbotene Leistungs-/Zeit-Versprechen oder künstliche Reaktionen erzeugt werden. Bitte erneut versuchen.'
            : 'Could not produce a TikTok diagnosis without invented metrics, forbidden performance/time promises or prescribed reactions after several attempts. Please try again.',
        );
      }
      if (softV.length > 0) {
        console.log(
          `[tiktok] diagnose soft REJECTED (${softV.join('|')}) (attempt ${attempt}) — regenerating`,
        );
        if (attempt < MAX_TIKTOK_ATTEMPTS) continue;
        console.log('[tiktok] diagnose last attempt still soft-violated — delivering result (soft)');
      }
    } else {
      // Qualitäts-Prüfung ERST (Regel-A/B + selfCheck), dann Vollständigkeit:
      // eine verbotene/regelwidrige Idee wird auch dann verworfen, wenn sie
      // zudem unvollständig ist — die Ablehnungsgründe gehen nie verloren.
      const violations = ruleABViolations(ideaContentBlob(result));
      // Diversität/Inhalt (todayIdea): deterministische Selbstreferenz-Erkennung
      // („Kann Growimo eine TikTok-Idee erstellen?", „Wir testen unser eigenes
      // Produkt", …) → Soft-Reject + Retry, damit keine produktzentrierte
      // Selbstthematisierung ausgegeben wird.
      // Phase 2 (C8): Der Selbstreferenz-Check gilt jetzt auch für concept —
      // aber nur, wenn Growimo das Thema selbst wählt (kein Nutzerthema), weil
      // er dort exakt dieselbe Rolle wie im todayIdea-Modus hat. Gibt der Nutzer
      // ein Thema vor, IST dieses Thema der Gegenstand (Phase-1-Vorrang); ein
      // breites Muster wie „Wie gut ist meine …?" würde sonst legitime
      // Zielgruppen-Themen („Wie gut ist meine Bewerbung wirklich?") ablehnen.
      const userTopicProvided = Boolean(input.topic?.trim());
      const selfRefs =
        input.mode === 'todayIdea' || !userTopicProvided
          ? selfReferenceViolations(ideaContentBlob(result))
          : [];
      // Phase 2 — Platzhalter-Verbot (deterministisch): generische Ausfüll-
      // Anweisungen sind kein Ergebnis → Soft-Reject + Retry; auf dem letzten
      // Versuch werden sie zusätzlich hart entfernt (placeholderFreeResult).
      const placeholders = placeholderViolations(ideaPlaceholderBlob(result));
      // Phase 5g — Anti-Generik (deterministisch, Owner-Kriterien 3+4):
      // austauschbare Standard-Werbesätze („Finde deinen Stil", „Der
      // Unterschied ist sofort sichtbar", …) sind KEIN Ergebnis → Soft-Reject
      // + Retry; auf dem letzten Versuch werden sie hart entfernt.
      const generic = genericViolations(ideaPlaceholderBlob(result));
      lastViolations = [...violations, ...selfRefs, ...placeholders, ...generic];
      // Phase 1: eigenes Nutzerthema (oder gar kein Markenkontext) ⇒ das Fehlen
      // eines Markenfakts darf die Idee NICHT verwerfen.
      const userSubjectProvided = Boolean(input.topic?.trim()) || !input.brandContext;
      const scRejected = result.selfCheck
        ? selfCheckRejected(result.selfCheck, { userSubjectProvided })
        : false;
      if (scRejected || lastViolations.length > 0) {
        const reason = scRejected ? 'self-check' : 'Rule A/B';
        console.log(
          `[tiktok] ${input.mode} ${reason} REJECTED (attempt ${attempt}) — regenerating` +
            (result.selfCheck ? ` selfCheck=${JSON.stringify(result.selfCheck)}` : '') +
            (lastViolations.length > 0 ? ` ruleA/B+selfRef=${lastViolations.join('|')}` : ''),
        );
        if (attempt < MAX_TIKTOK_ATTEMPTS) continue;
        // Fail closed bei Regel-Verletzungen: NIE eine Regel-A-/B-Verletzung ausgeben.
        if (violations.length > 0) {
          throw new Error(
            lang === 'de'
              ? 'Die TikTok-Idee konnte nach mehrmaligem Versuch nicht ohne verbotene Leistungs-/Zeit-Versprechen oder künstliche Reaktionen erzeugt werden. Bitte erneut versuchen.'
              : 'Could not produce a TikTok idea without forbidden unproven performance/time promises or prescribed reactions after several attempts. Please try again.',
          );
        }
        // Fail closed bei HARD REJECT (erfundenes Testimonial/Zitat, unbelegtes
        // Versprechen, vorgegebene Begeisterung): ehrlicher Fehler statt Ausgabe.
        if (
          result.selfCheck &&
          (result.selfCheck.inventsUserOrTestimonial === true ||
            result.selfCheck.unprovenPerformancePromise === true ||
            result.selfCheck.prescribedEnthusiasm === true)
        ) {
          throw new Error(
            lang === 'de'
              ? 'Die TikTok-Idee konnte nach mehrmaligem Versuch nicht ohne erfundene Testimonials, verbotene Leistungs-/Zeit-Versprechen oder künstliche Reaktionen erzeugt werden. Bitte erneut versuchen.'
              : 'Could not produce a TikTok idea without invented testimonials, forbidden performance/time promises or prescribed reactions after several attempts. Please try again.',
          );
        }
        // Nur Soft-Reject (z. B. austauschbar/werblich) bei erschöpften Versuchen:
        // bestmögliche letzte Idee ausliefern.
      }
      // Phase 2 — Vollständigkeitsprüfung: format/timedScenes/title/imageIdeas
      // werden im Prompt als PFLICHT verlangt; fehlen sie, wird mit gezieltem
      // Hinweis neu generiert. Auf dem letzten Versuch wird das (weiterhin
      // gültige) Ergebnis mit den alten Feldern zurückgegeben statt zu scheitern
      // (Parser-Fallback im UI) — kein hartes Fail-closed für fehlende neue Felder.
      const missing = conceptCompleteness(result);
      if (missing.length > 0) {
        lastMissing = missing;
        console.log(
          `[tiktok] ${input.mode} INCOMPLETE (${missing.join(', ')}) — regenerating (attempt ${attempt})`,
        );
        if (attempt < MAX_TIKTOK_ATTEMPTS) continue;
        console.log('[tiktok] last attempt still incomplete — returning result with old fields (soft fallback)');
      } else {
        lastMissing = [];
      }
    }

    // Phase 4 — metric-guard auf TikTok-Outputs: das AKZEPTIERTE Ergebnis
    // (aller Modi) durchläuft vor der Ausgabe die Guard (Pendant), damit keine
    // erfundenen Leistungsdaten/Trends den Weg ins UI finden. Nutzerzahlen sind
    // über buildSanitizeUserContext geschützt; ohne Muster = Fast-Path.
    // Phase 2 — Platzhalter-Endreinigung VOR der metric-guard: ein akzeptiertes
    // Ergebnis verlässt die Engine nie mit generischen Ausfüll-Anweisungen.
    const cleaned =
      result.mode === 'diagnose'
        ? result
        : genericFreeResult(placeholderFreeResult(result));
    const sanitized = await sanitizeTikTokResult(cleaned, buildSanitizeUserContext(input));
    console.log(
      `[tiktok] ${input.mode} OK (${lang}) — idea/analysis generated` +
        (result.selfCheck ? ` selfCheck=${JSON.stringify(result.selfCheck)}` : '') +
        (cleaned !== result ? ' [placeholders stripped]' : '') +
        (sanitized !== cleaned ? ' [metric-guard applied]' : ''),
    );
    return sanitized;
  }

  // Theoretisch unerreichbar (die Schleife wirft bei erschöpften Versuchen) — Sicherheitsnetz.
  throw new Error(
    lang === 'de'
      ? 'Die TikTok-Antwort konnte nicht gelesen werden. Bitte erneut versuchen.'
      : 'Could not read the TikTok response. Please try again.',
  );
}

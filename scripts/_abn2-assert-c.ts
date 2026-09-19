/* Stabilisierung Phase 5b — Content-Assertions fuer Test C (TikTok-Konzept).
 * Liest /tmp/C1-result.json + /tmp/C2-result.json (agent-browser eval-Ausgabe:
 * JSON-String, der den Ergebnis-Wrapper enthaelt) und prueft die Pruefmarker. */
import fs from "fs";
function load(p: string) {
  const raw = fs.readFileSync(p, "utf8").trim();
  let v: any = JSON.parse(raw); // aussen: seroval-String
  if (typeof v === "string") v = JSON.parse(v); // innen: unsere Struktur
  return v;
}
const clean = (s: string) => s.replace(/📋\s*Kopieren/g, "").replace(/\s+$/g, "").trim();
function report(name: string, file: string) {
  const d = load(file);
  const f: Record<string, string> = d.fields || {};
  const all = clean(d.text || "");
  const get = (needle: string) => {
    const k = Object.keys(f).find((x) => x.includes(needle));
    return k ? clean(f[k]) : "";
  };
  const idea = get("Video-Idee");
  const hook = get("Hook");
  const scroll = get("Scroll-Stop");
  const timed = get("Szenenplan");
  const scenes = get("Szenenablauf");
  const overlays = get("Texteinblendungen");
  const spoken = get("Sprechtext");
  const tension = get("Spannungsbogen");
  const caption = get("Caption");
  const hashtags = get("Hashtags");
  const cta = get("CTA");
  const lengthF = get("Videolänge");
  const format = get("Video-Format");
  const title = get("TikTok-Titel");
  const why = get("Warum");
  const imageIdeas = get("Bild-/Videoideen");
  const recPlan = get("Aufnahme-Anleitung");
  const tags = hashtags.split(/\s+/).filter((x) => x.startsWith("#"));
  const placeholders = all.match(/\[[^\]]{3,}\]/g) || [];
  const fillers =
    all.match(
      /(hier einfügen|Sound einfügen|\[Hier|\[Dein|\[Trendigen|dein Text|Platzhalter|Lorem|XXX|\bTBD\b)/gi,
    ) || [];
  const timeMarks = timed.match(/\d+\s*(?:[–-]\s*\d+\s*)?(?:Sek\b|Sekunden|s\b)/g) || [];
  const checks: Record<string, boolean> = {
    "Hook vorhanden (konkret, erste 1–2 Sek.)": hook.length > 0,
    "Scroll-Stop-Moment vorhanden": scroll.length > 0,
    "Szenenplan mit Zeitangaben (>=2 Zeitmarken)": timeMarks.length >= 2,
    "Texteinblendungen (Overlays) vorhanden": overlays.length > 0,
    "Sprechtext/Voice-over vorhanden": spoken.length > 0,
    "Spannungsbogen/Tension vorhanden": tension.length > 0,
    "Caption vorhanden": caption.length > 0,
    "Hashtags vorhanden und <= 5": tags.length > 0 && tags.length <= 5,
    "Videolänge empfohlen": lengthF.length > 0,
    "Video-Format angegeben": format.length > 0,
    "KEINE Platzhalter [ ... ]": placeholders.length === 0,
    "KEINE Filler-Formulierungen": fillers.length === 0,
    "Erklärung 'Warum' vorhanden": why.length > 0,
    "Bildideen für Studio vorhanden": imageIdeas.length > 0,
    "Aufnahme-Anleitung vorhanden": recPlan.length > 0,
  };
  const excerpts: Record<string, string> = {
    "Video-Idee": idea,
    Hook: hook,
    ScrollStop: scroll,
    Szenenplan: timed,
    Szenenablauf: scenes,
    Texteinblendungen: overlays,
    Sprechtext: spoken,
    Spannungsbogen: tension,
    Caption: caption,
    Hashtags: hashtags,
    CTA: cta,
    Titel: title,
    Videolänge: lengthF,
    Format: format,
  };
  console.log("===== " + name + " =====");
  console.log(
    JSON.stringify(
      {
        len: d.len,
        fieldCount: Object.keys(f).length,
        checks,
        facts: {
          hashtagCount: tags.length,
          hashtags: tags,
          timeMarks: timeMarks.slice(0, 8),
          timeMarkCount: timeMarks.length,
          placeholderHits: placeholders.slice(0, 5),
          fillerHits: fillers.slice(0, 5),
        },
      },
      null,
      2,
    ),
  );
  console.log("--- WOERTLICHE AUSSCHNITTE ---");
  for (const [k, v] of Object.entries(excerpts)) console.log(`${k}: ${v}`);
  console.log("");
}
report("TEST C — Idee 1: personalisierte Tasse", "/tmp/C1-result.json");
report("TEST C — Idee 2: minimalistischer Schmuck", "/tmp/C2-result.json");

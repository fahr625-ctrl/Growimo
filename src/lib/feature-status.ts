import type { Translations } from "~/i18n";

// ── Funktionsstatus in drei Stufen (Owner-Vorgabe 2026-11-24) ──────────────────
// Der Status ist DATEN, nicht Fließtext: jede Funktion hat genau eine Stufe aus
// „Live" · „In der Vorschau fertig" · „In Entwicklung". Beim Live-Schalten wird
// hier nur `stage` geändert — kein Satz auf der Seite bleibt zurück, der etwas
// anderes behauptet. Keine Zahlen, keine Kundenstimmen, keine Preisversprechen.

export type FeatureStage = "live" | "preview" | "dev";

export type FeatureChannel = "pinterest" | "etsy" | "tiktok";

export type FeatureStatusEntry = {
  id: string;
  channel: FeatureChannel | null;
  /** i18n-Key des Funktionstitels. */
  titleKey: keyof Translations;
  stage: FeatureStage;
};

/** Reihenfolge der Stufen — bestimmt Spalten im Statusblock. */
export const STAGES: readonly FeatureStage[] = ["live", "preview", "dev"] as const;

/** Beschriftung je Stufe (zugleich Spaltenüberschrift im Statusblock). */
export const STAGE_LABEL_KEY: Record<FeatureStage, keyof Translations> = {
  live: "home_stage_live",
  preview: "home_stage_preview",
  dev: "home_stage_dev",
};

export const FEATURE_STATUS: readonly FeatureStatusEntry[] = [
  // ── A · Öffentlich verfügbar (live) ─────────────────────────────────────────
  { id: "pin_texts", channel: "pinterest", titleKey: "home_feat_pin_texts", stage: "live" },
  { id: "pin_campaign", channel: "pinterest", titleKey: "home_feat_pin_campaign", stage: "live" },
  { id: "etsy_texts", channel: "etsy", titleKey: "home_feat_etsy_texts", stage: "live" },
  { id: "tiktok_script", channel: "tiktok", titleKey: "home_feat_tiktok_script", stage: "live" },
  { id: "bild_studio", channel: null, titleKey: "home_feat_bild_studio", stage: "live" },

  // ── B · In der Vorschau fertig und getestet (noch nicht live) ───────────────
  { id: "pin_image_text", channel: "pinterest", titleKey: "home_feat_pin_image_text", stage: "preview" },
  { id: "pin_designs", channel: "pinterest", titleKey: "home_feat_pin_designs", stage: "preview" },
  { id: "etsy_mockups", channel: "etsy", titleKey: "home_feat_etsy_mockups", stage: "preview" },

  // ── C · Noch in Entwicklung / nicht verfügbar ───────────────────────────────
  { id: "pin_api", channel: "pinterest", titleKey: "home_feat_pin_api", stage: "dev" },
  { id: "tiktok_lengths", channel: "tiktok", titleKey: "home_feat_tiktok_lengths", stage: "dev" },
  { id: "tiktok_video", channel: "tiktok", titleKey: "home_feat_tiktok_video", stage: "dev" },
] as const;

/** Einträge eines Kanals in der Reihenfolge der Liste (für die Werkzeug-Karten). */
export function featuresOfChannel(channel: FeatureChannel): readonly FeatureStatusEntry[] {
  return FEATURE_STATUS.filter((entry) => entry.channel === channel);
}

/** Einträge einer Stufe (für die Spalten im Statusblock). */
export function featuresOfStage(stage: FeatureStage): readonly FeatureStatusEntry[] {
  return FEATURE_STATUS.filter((entry) => entry.stage === stage);
}

/**
 * Teil A der UI-Neuausrichtung (Owner-Vorgabe 2026-11-12, SPEC.md).
 * Setzt die verbindlichen Texte + die drei Kernfunktionen im Dashboard um.
 * Jede Ersetzung muss GENAU EINMAL passen, sonst bricht das Skript ab.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;

function rep(file: string, from: string, to: string): void {
  const path = root + file;
  const src = readFileSync(path, 'utf8');
  const count = src.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`[${file}] erwartet 1 Treffer, gefunden ${count}: ${from.slice(0, 90)}`);
  }
  writeFileSync(path, src.replace(from, to));
}

// ─── i18n DE ────────────────────────────────────────────────────────────────
const DE = 'src/i18n/de.ts';
rep(DE, "  strategy_title: 'Marketing-Strategie erstellen',", "  strategy_title: 'Was möchtest du heute erstellen?',");
rep(DE, "  strategy_subtitle: 'Eine Idee. Alle Kanäle. Ein Klick.',", "  strategy_subtitle: 'Deine Idee. Dein fertiger Content. In wenigen Klicks.',");
rep(
  DE,
  "  strategy_select_types_desc: 'Wähle aus, was für deine Strategie generiert werden soll.',",
  "  strategy_select_types_desc: 'Wähle aus, was Growimo für dich erstellt.',",
);
rep(DE, "  strategy_create_btn: '🚀 Strategie erstellen',", "  strategy_create_btn: 'Erstellen',");
rep(
  DE,
  "  strategy_tile_pinterest_desc: 'Pin-Titel, Beschreibung, Keywords & Bild-Prompt',",
  "  strategy_tile_pinterest_desc: 'Fertiger Pin mit Bild und SEO-Texten',",
);
rep(
  DE,
  "  strategy_tile_etsy_desc: 'Etsy-Titel, Beschreibung & alle 13 Tags',",
  "  strategy_tile_etsy_desc: 'Fertiges Listing mit Titel, Beschreibung, 13 Tags und Mockup',",
);
rep(
  DE,
  "  strategy_tile_tiktok_desc: 'Videoskript mit Zeitangaben, Sprechtext & 5 Hashtags',",
  "  strategy_tile_tiktok_desc: 'Fertiges Videoskript mit Hook, Szenen, Titel, Beschreibung und Hashtags',",
);
rep(DE, "  strategy_create_btn_pinterest: '📌 Pin erstellen',", "  strategy_create_btn_pinterest: 'Pinterest-Pin erstellen',");
rep(DE, "  strategy_create_btn_etsy: '🛍️ Listing erstellen',", "  strategy_create_btn_etsy: 'Etsy-Listing erstellen',");
rep(DE, "  sidebar_new_strategy: 'Neue Strategie',", "  sidebar_new_strategy: 'Inhalte erstellen',");
rep(DE, "  dashboard_new_strategy: 'Neue Strategie',", "  dashboard_new_strategy: 'Inhalte erstellen',");
rep(DE, "  dashboard_cta_new: 'Neue Strategie erstellen',", "  dashboard_cta_new: 'Inhalte erstellen',");
rep(DE, "  results_new: 'Neue Strategie',", "  results_new: 'Inhalte erstellen',");
rep(DE, "  calendar_new_strategy: 'Neue Strategie',", "  calendar_new_strategy: 'Inhalte erstellen',");
rep(
  DE,
  "  dashboard_welcome_subtitle: 'Erstelle in weniger als einer Minute deine erste Marketingstrategie. Beschreibe einfach dein Produkt und Growimo erstellt Inhalte für Pinterest, Etsy, SEO, Social Media, Newsletter und mehr.',",
  "  dashboard_welcome_subtitle: 'Growimo erstellt drei fertige Inhalte: Pinterest-Pin, Etsy-Listing und TikTok-Skript.',",
);
rep(
  DE,
  "  dashboard_cta_create: '🚀 Erste Marketingstrategie erstellen',",
  "  dashboard_cta_create: 'Inhalte erstellen',\n" +
    "  dashboard_core_title: 'Was möchtest du heute erstellen?',\n" +
    "  dashboard_core_pinterest: 'Pinterest-Pin erstellen',\n" +
    "  dashboard_core_etsy: 'Etsy-Listing erstellen',\n" +
    "  dashboard_core_tiktok: 'Videoskript erstellen',",
);
rep(DE, "  dashboard_how_step2: 'Strategie generieren',", "  dashboard_how_step2: 'Inhalte erstellen',");
rep(
  DE,
  "    'Erstelle deine erste Marketing-Strategie und generiere Content für alle Kanäle mit einem Klick.',",
  "    'Erstelle deinen ersten Pinterest-Pin, dein erstes Etsy-Listing oder dein erstes TikTok-Skript.',",
);
rep(DE, "  dashboard_empty_cta: 'Erste Strategie erstellen',", "  dashboard_empty_cta: 'Inhalte erstellen',");
rep(DE, "  dashboard_empty_title: 'Noch keine Marketingstrategien erstellt',", "  dashboard_empty_title: 'Noch keine Inhalte erstellt',");
rep(
  DE,
  "  dashboard_empty_text: 'Mit deiner ersten Strategie erstellt Growimo Inhalte für mehrere Marketingkanäle gleichzeitig.',",
  "  dashboard_empty_text: 'Growimo erstellt drei fertige Inhalte: Pinterest-Pin, Etsy-Listing und TikTok-Skript.',",
);

// ─── i18n EN ────────────────────────────────────────────────────────────────
const EN = 'src/i18n/en.ts';
rep(EN, "  strategy_title: 'Create Marketing Strategy',", "  strategy_title: 'What would you like to create today?',");
rep(EN, "  strategy_subtitle: 'One idea. All channels. One click.',", "  strategy_subtitle: 'Your idea. Your finished content. In a few clicks.',");
rep(
  EN,
  "  strategy_select_types_desc: 'Choose what to generate for your strategy.',",
  "  strategy_select_types_desc: 'Choose what Growimo creates for you.',",
);
rep(EN, "  strategy_create_btn: '🚀 Create strategy',", "  strategy_create_btn: 'Create',");
rep(
  EN,
  "  strategy_tile_pinterest_desc: 'Pin titles, descriptions, keywords & image prompt',",
  "  strategy_tile_pinterest_desc: 'Finished pin with image and SEO texts',",
);
rep(
  EN,
  "  strategy_tile_etsy_desc: 'Etsy title, description & all 13 tags',",
  "  strategy_tile_etsy_desc: 'Finished listing with title, description, 13 tags and mockup',",
);
rep(
  EN,
  "  strategy_tile_tiktok_desc: 'Video script with timings, spoken text & 5 hashtags',",
  "  strategy_tile_tiktok_desc: 'Finished video script with hook, scenes, title, description and hashtags',",
);
rep(EN, "  strategy_create_btn_pinterest: '📌 Create pin',", "  strategy_create_btn_pinterest: 'Create Pinterest pin',");
rep(EN, "  strategy_create_btn_etsy: '🛍️ Create listing',", "  strategy_create_btn_etsy: 'Create Etsy listing',");
rep(EN, "  sidebar_new_strategy: 'New Strategy',", "  sidebar_new_strategy: 'Create content',");
rep(EN, "  dashboard_new_strategy: 'New Strategy',", "  dashboard_new_strategy: 'Create content',");
rep(EN, "  dashboard_cta_new: 'Create New Strategy',", "  dashboard_cta_new: 'Create content',");
rep(EN, "  results_new: 'New Strategy',", "  results_new: 'Create content',");
rep(EN, "  calendar_new_strategy: 'New Strategy',", "  calendar_new_strategy: 'Create content',");
rep(
  EN,
  "  dashboard_welcome_subtitle: 'Create your first marketing strategy in less than a minute. Simply describe your product and Growimo creates content for Pinterest, Etsy, SEO, Social Media, newsletters, and more.',",
  "  dashboard_welcome_subtitle: 'Growimo creates three finished pieces of content: a Pinterest pin, an Etsy listing and a TikTok script.',",
);
rep(
  EN,
  "  dashboard_cta_create: '🚀 Create your first marketing strategy',",
  "  dashboard_cta_create: 'Create content',\n" +
    "  dashboard_core_title: 'What would you like to create today?',\n" +
    "  dashboard_core_pinterest: 'Create Pinterest pin',\n" +
    "  dashboard_core_etsy: 'Create Etsy listing',\n" +
    "  dashboard_core_tiktok: 'Create video script',",
);
rep(EN, "  dashboard_how_step2: 'Generate strategy',", "  dashboard_how_step2: 'Create content',");
rep(
  EN,
  "    'Create your first marketing strategy and generate content for all channels with one click.',",
  "    'Create your first Pinterest pin, your first Etsy listing or your first TikTok script.',",
);
rep(EN, "  dashboard_empty_cta: 'Create first strategy',", "  dashboard_empty_cta: 'Create content',");
rep(EN, "  dashboard_empty_title: 'No marketing strategies created yet',", "  dashboard_empty_title: 'No content created yet',");
rep(
  EN,
  "  dashboard_empty_text: 'With your first strategy, Growimo creates content for multiple marketing channels at once.',",
  "  dashboard_empty_text: 'Growimo creates three finished pieces of content: a Pinterest pin, an Etsy listing and a TikTok script.',",
);

console.log('i18n ok');

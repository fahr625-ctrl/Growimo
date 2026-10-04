// ── Owner 2026-10-03 (Stabilisierungspaket Schritt 1, Punkt 1c) ───────────────
// "Wähle die beste" spiegelte bisher die tatsächlichen Einzelbewertungen nicht:
// die Varianten standen in Generierungs-Reihenfolge, ohne Empfehlung, ohne
// Score-Abstand. Diese reine Funktion sortiert nach dem echten Score, benennt
// die Empfehlung ausschließlich dann, wenn sie WIRKLICH vorne liegt (kein
// Gleichstand geschönt) und rechnet den Abstand zur zweitbesten aus.
//
// Bewusst ohne React: so ist die Ranking-Logik direkt testbar (siehe
// varianten-scoring-konsistenz-test.ts). Der Nutzer kann weiterhin JEDE
// Variante wählen — die Anzeige zwingt nichts.

import type { VariantAsset } from '~/ai/types';

export interface RankedVariant {
  /** Original-Position aus der Generierung (bestimmt das A/B/C-Kürzel). */
  index: number;
  variant: VariantAsset;
  /** score.total, oder null wenn keine Bewertung vorliegt. */
  total: number | null;
}

export interface VariantRanking {
  /** Nach Score absteigend; unbewertete Varianten ans Ende (stabile Reihenfolge). */
  ranked: RankedVariant[];
  /** Index der Original-Position, die empfohlen wird (-1 = keine Empfehlung). */
  recommendedIndex: number;
  /** Punkte der besten Variante (null ohne Bewertung). */
  bestTotal: number | null;
  /** Zweitbester Punktwert (null wenn es keine zweite Bewertung gibt). */
  secondTotal: number | null;
  /** bestTotal − secondTotal (0 bei Gleichstand, null ohne Vergleichswert). */
  deltaToRunnerUp: number | null;
  /** true = mindestens zwei Bewertungen liegen gleichauf an der Spitze. */
  tie: boolean;
}

/** Sortiert Varianten nach ihrer echten Bewertung und leitet die Empfehlung ab. */
export function rankVariants(variants: VariantAsset[]): VariantRanking {
  const entries: RankedVariant[] = variants.map((variant, index) => ({
    index,
    variant,
    total: typeof variant.score?.total === 'number' ? variant.score.total : null,
  }));

  // Absteigend nach Score; unbewertete ans Ende; Gleichstand behält die
  // Generierungs-Reihenfolge (Array.prototype.sort ist stabil).
  const ranked = [...entries].sort((a, b) => {
    if (a.total == null && b.total == null) return a.index - b.index;
    if (a.total == null) return 1;
    if (b.total == null) return -1;
    if (b.total !== a.total) return b.total - a.total;
    return a.index - b.index;
  });

  const scored = ranked.filter((e) => e.total != null);
  const best = scored[0] ?? null;
  const second = scored[1] ?? null;
  const bestTotal = best?.total ?? null;
  const secondTotal = second?.total ?? null;
  const tie = bestTotal != null && secondTotal != null && bestTotal === secondTotal;
  // Eine Empfehlung nur bei einem echten Vorsprung — ein Gleichstand wird als
  // Gleichstand gezeigt, nicht als Empfehlung.
  const recommendedIndex =
    best && !tie && secondTotal != null ? best.index : -1;

  return {
    ranked,
    recommendedIndex,
    bestTotal,
    secondTotal,
    deltaToRunnerUp: bestTotal != null && secondTotal != null ? bestTotal - secondTotal : null,
    tie,
  };
}

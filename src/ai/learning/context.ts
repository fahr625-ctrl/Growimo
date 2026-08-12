// ── F10 Persönliche Lernschleife: Kontext-Block für zukünftige Generierungen ─
// buildLearningContext() übersetzt die abgeleitete Präferenz-View in einen
// kurzen Zusatz-Kontext für ALLE zukünftigen Generierungen (Paket +
// QuickGenerator) — nie blockierend, bei 0 Signalen leer.
// Ehrlichkeit statt Übersteuerung:
//   - 0 Signale → leerer String (nichts fließt ein)
//   - 1–2 Signale → Warn-Block MIT Flag: zu wenig Daten, nicht steuern lassen
//   - >= 3 Signale → Präferenz-Block NUR mit klar belegten Dimensionen
//     (keine erfundenen Präferenzen aus Rauschen)

import type { UserPreferencesView } from '../types';
import type { LearnLang } from './wording';
import { TONE_LABEL, FORMAT_LABEL, CHANNEL_LABEL } from './wording';
import { MIN_FEEDBACK_SIGNALS } from './profile';

const HEADER: Record<LearnLang, string> = {
  de: '🧠 Deine gelernten Präferenzen (aus deinem 👍/👎-Feedback — setze sie in diesem Inhalt um):',
  en: '🧠 Your learned preferences (from your 👍/👎 feedback — apply them to this content):',
};
const WEAK_HEADER: Record<LearnLang, string> = {
  de: '🧠 Dein Feedback wird erfasst (n = %d) — erst ab %d Bewertungen steuert Growimo Ton & Format. Bitte nicht von diesen schwachen Signalen steuern lassen.',
  en: '🧠 Your feedback is being collected (n = %d) — Growimo only steers tone & format after %d ratings. Please do not over-steer from these weak signals.',
};
const TONE_LINE: Record<LearnLang, string> = {
  de: 'Bevorzugter Ton',
  en: 'Preferred tone',
};
const FORMAT_LINE: Record<LearnLang, string> = {
  de: 'Bevorzugtes Format',
  en: 'Preferred format',
};
const CHANNEL_LINE: Record<LearnLang, string> = {
  de: 'Bevorzugter Kanal',
  en: 'Preferred channel',
};

export function buildLearningContext(
  view: UserPreferencesView | null | undefined,
  lang: LearnLang = 'de',
): string {
  if (!view || view.totalSignals === 0) return '';

  // Zu wenig Signale: ehrlicher Warn-Block mit Flag (nichts erfinden).
  if (!view.enoughData) {
    return WEAK_HEADER[lang].replace('%d', String(view.totalSignals)).replace('%d', String(MIN_FEEDBACK_SIGNALS));
  }

  const lines: string[] = [];
  if (view.preferredTone) {
    const label = TONE_LABEL[view.preferredTone]?.[lang];
    if (label) lines.push(`- ${TONE_LINE[lang]}: ${label}`);
  }
  if (view.preferredFormat) {
    const label = FORMAT_LABEL[view.preferredFormat]?.[lang];
    if (label) lines.push(`- ${FORMAT_LINE[lang]}: ${label}`);
  }
  if (view.preferredChannel) {
    const label = CHANNEL_LABEL[view.preferredChannel]?.[lang] ?? view.preferredChannel;
    lines.push(`- ${CHANNEL_LINE[lang]}: ${label}`);
  }

  // Daten ausreichend, aber kein klares Muster → ehrlich leer (wie F9).
  if (lines.length === 0) return '';

  return `${HEADER[lang]}\n${lines.join('\n')}`;
}

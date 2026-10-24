// ── Owner-Vorgabe 2026-10-23: Widerruf muss technisch wirken ─────────────────
// @vercel/analytics wird NUR geladen, wenn im Browser kein Opt-out gesetzt ist
// (`growimo_analytics_optout`, gesetzt über den Schalter in /datenschutz).
//
// SSR/Hydration: <Analytics /> ist ohnehin rein clientseitig; dieser Wrapper
// rendert beim ersten Render und auf dem Server nichts und entscheidet nach der
// Hydration — damit gibt es keinen Hydration-Mismatch und das Skript wird bei
// gesetztem Opt-out gar nicht erst nachgeladen.
import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { isAnalyticsOptedOut } from '~/lib/analytics-consent';

export function VercelAnalytics() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(!isAnalyticsOptedOut());
  }, []);

  if (!allowed) return null;
  return <Analytics />;
}

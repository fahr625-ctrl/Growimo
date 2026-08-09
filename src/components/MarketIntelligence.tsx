import { useTranslation } from '~/i18n';

// ── Helpers ──────────────────────────────────────────────────────────────────────

function ratingBadge(rating: string): { bg: string; text: string; dot: string } {
  const r = rating.trim().toLowerCase();
  if (r === 'hoch' || r === 'high') return { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' };
  if (r === 'mittel' || r === 'medium') return { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' };
  return { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' };
}

function sizeBadge(size: string): string {
  const s = size.trim().toLowerCase();
  if (s === 'groß' || s === 'large') return 'bg-emerald-100 text-emerald-800';
  if (s === 'mittel' || s === 'medium') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-600';
}

function probBadge(prob: string): string {
  const p = prob.trim().toLowerCase();
  if (p === 'hoch' || p === 'high') return 'bg-red-100 text-red-800';
  if (p === 'mittel' || p === 'medium') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-600';
}

function priorityBadge(p: string): string {
  const pp = p.trim().toLowerCase();
  if (pp === 'hoch' || pp === 'high') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

function extractRating(text: string | null): { rating: string; description: string } {
  if (!text) return { rating: 'Nicht verfügbar', description: '' };
  const ratingMatch = text.match(/Bewertung:\s*(Hoch|Mittel|Niedrig)/i);
  const rating = ratingMatch?.[1] ?? 'Nicht verfügbar';
  // Remove the rating line to get description
  const descLines = text.split('\n').filter((l) => !l.match(/Bewertung:/i));
  const description = descLines.join(' ').trim();
  return { rating, description };
}

// ── Parse helpers ────────────────────────────────────────────────────────────────

interface SeasonalChance {
  occasion: string;
  reason: string;
  chance: string;
}

function parseSeasonal(text: string | null): SeasonalChance[] {
  if (!text) return [];
  const items: SeasonalChance[] = [];
  const regex = /-\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+?)\s*[—–-]\s*Chancen-Bewertung:\s*(Hoch|Mittel)/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    items.push({ occasion: m[1].trim(), reason: m[2].trim(), chance: m[3].trim() });
  }
  return items;
}

interface PriceInfo {
  recommended: string;
  justification: string;
  premium: string;
}

function parsePrice(text: string | null): PriceInfo {
  if (!text) return { recommended: 'N/A', justification: '', premium: 'N/A' };
  const recMatch = text.match(/\*\*Empfohlener Preis\*\*:\s*(.+?)(?:\n|$)/);
  const justMatch = text.match(/\*\*Begründung\*\*:\s*(.+?)(?:\n|$)/);
  const premMatch = text.match(/\*\*Premium-Potenzial\*\*:\s*(.+?)(?:\n|$)/);
  return {
    recommended: recMatch?.[1]?.trim() ?? 'N/A',
    justification: justMatch?.[1]?.trim() ?? '',
    premium: premMatch?.[1]?.trim() ?? 'N/A',
  };
}

interface AudienceInfo {
  primary: string;
  primarySize: string;
  secondary: string;
  secondarySize: string;
  reach: string;
}

function parseAudience(text: string | null): AudienceInfo {
  if (!text) return { primary: '', primarySize: '', secondary: '', secondarySize: '', reach: '' };
  const primMatch = text.match(/\*\*Primäre Zielgruppe\*\*:\s*(.+?)\s*[—–-]\s*Größe:\s*(Groß|Mittel|Nische)/);
  const secMatch = text.match(/\*\*Sekundäre Zielgruppe\*\*:\s*(.+?)\s*[—–-]\s*Größe:\s*(Groß|Mittel|Nische)/);
  const reachMatch = text.match(/\*\*Erreichbarkeit\*\*:\s*(.+?)(?:\n|$)/);
  return {
    primary: primMatch?.[1]?.trim() ?? '',
    primarySize: primMatch?.[2]?.trim() ?? '',
    secondary: secMatch?.[1]?.trim() ?? '',
    secondarySize: secMatch?.[2]?.trim() ?? '',
    reach: reachMatch?.[1]?.trim() ?? '',
  };
}

interface CrossSellItem {
  product: string;
  why: string;
  potential: string;
}

function parseCrossSell(text: string | null): CrossSellItem[] {
  if (!text) return [];
  const items: CrossSellItem[] = [];
  const regex = /-\s*\*\*Produkt\*\*:\s*(.+?)\s*[—–-]\s*Warum:\s*(.+?)\s*[—–-]\s*Cross-Sell-Potenzial:\s*(Hoch|Mittel)/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    items.push({ product: m[1].trim(), why: m[2].trim(), potential: m[3].trim() });
  }
  return items;
}

interface UpsellItem {
  idea: string;
  value: string;
  surcharge: string;
}

function parseUpsell(text: string | null): UpsellItem[] {
  if (!text) return [];
  const items: UpsellItem[] = [];
  const regex = /-\s*\*\*Idee\*\*:\s*(.+?)\s*[—–-]\s*Mehrwert:\s*(.+?)\s*[—–-]\s*Aufpreis:\s*(.+?)(?:\n|$)/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    items.push({ idea: m[1].trim(), value: m[2].trim(), surcharge: m[3].trim() });
  }
  return items;
}

interface SWOT {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

function parseSWOT(text: string | null): SWOT {
  const result: SWOT = { strengths: [], weaknesses: [], opportunities: [], threats: [] };
  if (!text) return result;

  const extractList = (label: string): string[] => {
    const regex = new RegExp(`\\*\\*${label}:\\*\\*\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n\\*\\*|$)`, 'i');
    const m = text!.match(regex);
    if (!m) return [];
    return m[1]
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter((l) => l.length > 2);
  };

  result.strengths = extractList('Stärken');
  result.weaknesses = extractList('Schwächen');
  result.opportunities = extractList('Chancen');
  result.threats = extractList('Risiken');

  return result;
}

interface OppRisk {
  biggestOpportunity: string;
  opportunityProb: string;
  biggestRisk: string;
  riskProb: string;
  riskMitigation: string;
}

function parseOppRisks(text: string | null): OppRisk {
  if (!text) return { biggestOpportunity: '', opportunityProb: '', biggestRisk: '', riskProb: '', riskMitigation: '' };
  const oppMatch = text.match(/\*\*Größte Chance\*\*:\s*(.+?)\s*[—–-]\s*Eintrittswahrscheinlichkeit:\s*(Hoch|Mittel|Niedrig)/);
  const riskMatch = text.match(/\*\*Größtes Risiko\*\*:\s*(.+?)\s*[—–-]\s*Eintrittswahrscheinlichkeit:\s*(Hoch|Mittel|Niedrig)/);
  const mitMatch = text.match(/\*\*Handlungsempfehlung Risiko\*\*:\s*(.+?)(?:\n|$)/);
  return {
    biggestOpportunity: oppMatch?.[1]?.trim() ?? '',
    opportunityProb: oppMatch?.[2]?.trim() ?? '',
    biggestRisk: riskMatch?.[1]?.trim() ?? '',
    riskProb: riskMatch?.[2]?.trim() ?? '',
    riskMitigation: mitMatch?.[1]?.trim() ?? '',
  };
}

interface Recommendation {
  title: string;
  priority: string;
  reason: string;
  effect: string;
}

function parseRecommendations(text: string | null): Recommendation[] {
  if (!text) return [];
  const items: Recommendation[] = [];
  const regex = /^\d+\.\s*\*\*(.+?)\*\*\s*\[Priorität:\s*(Hoch|Mittel)\]\s*[—–-]\s*(.+?)\s*[—–-]\s*Erwarteter Effekt:\s*(.+?)$/gm;
  let m;
  while ((m = regex.exec(text)) !== null) {
    items.push({ title: m[1].trim(), priority: m[2].trim(), reason: m[3].trim(), effect: m[4].trim() });
  }
  return items;
}

// ── Metric Card ──────────────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  rating,
  description,
}: {
  icon: string;
  label: string;
  rating: string;
  description: string;
}) {
  const colors = ratingBadge(rating);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      </div>
      <div className="mb-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${colors.bg} ${colors.text}`}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${colors.dot}`} />
          {rating}
        </span>
      </div>
      {description && (
        <p className="text-xs leading-relaxed text-gray-600">{description}</p>
      )}
    </div>
  );
}

// ── Section Header ───────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800">
      <span>{icon}</span>
      {title}
    </h3>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────────

interface MarketIntelligenceProps {
  intelligenceText: string;
}

export default function MarketIntelligence({ intelligenceText }: MarketIntelligenceProps) {
  const { t } = useTranslation();

  // Parse sections from the raw text
  const extractSection = (name: string): string | null => {
    const regex = new RegExp(`###\\s*${name}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n###\\s|$)`, 'i');
    const m = intelligenceText.match(regex);
    return m ? m[1].trim() : null;
  };

  const demandSection = extractSection('Nachfragepotenzial');
  const competitionSection = extractSection('Wettbewerbsintensität');
  const seasonalSection = extractSection('Saisonale Chancen');
  const priceSection = extractSection('Preisempfehlung');
  const audienceSection = extractSection('Zielgruppenpotenzial');
  const crossSellSection = extractSection('Cross-Selling-Ideen');
  const upsellSection = extractSection('Upselling-Ideen');
  const swotSection = extractSection('SWOT-Analyse');
  const oppRiskSection = extractSection('Chancen & Risiken');
  const recSection = extractSection('Priorisierte Geschäftsempfehlungen');

  const demand = extractRating(demandSection);
  const competition = extractRating(competitionSection);
  const seasonal = parseSeasonal(seasonalSection);
  const price = parsePrice(priceSection);
  const audience = parseAudience(audienceSection);
  const crossSell = parseCrossSell(crossSellSection);
  const upsell = parseUpsell(upsellSection);
  const swot = parseSWOT(swotSection);
  const oppRisk = parseOppRisks(oppRiskSection);
  const recommendations = parseRecommendations(recSection);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
          <span>📊</span> {t.mi_title}
        </h2>
        <div className="mt-1 h-1 w-24 rounded-full bg-gradient-to-r from-blue-500 to-purple-500" />
      </div>

      {/* ── Top Row: 3 Metric Cards ─────────────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-3">
        <MetricCard
          icon="📈"
          label={t.mi_demand}
          rating={demand.rating}
          description={demand.description}
        />
        <MetricCard
          icon="⚔️"
          label={t.mi_competition}
          rating={competition.rating}
          description={competition.description}
        />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg">💶</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.mi_price}</span>
          </div>
          <div className="mb-2">
            <span className="text-2xl font-bold text-gray-900">{price.recommended}</span>
            {price.premium && (
              <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                {t.mi_price_premium}: {price.premium.startsWith('Ja') ? '✅ Ja' : price.premium.startsWith('Nein') ? '❌ Nein' : price.premium}
              </span>
            )}
          </div>
          {price.justification && (
            <p className="text-xs leading-relaxed text-gray-600">{price.justification}</p>
          )}
        </div>
      </div>

      {/* ── Second Row: Seasonal + Audience ─────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Seasonal */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <SectionHeader icon="📅" title={t.mi_seasonal} />
          {seasonal.length > 0 ? (
            <div className="space-y-3">
              {seasonal.map((s, i) => {
                const colors = ratingBadge(s.chance);
                return (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <span className="mt-0.5 flex-shrink-0 rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">
                      {s.occasion}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700">{s.reason}</p>
                      <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                        {s.chance}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs italic text-gray-400">Keine saisonalen Daten verfügbar.</p>
          )}
        </div>

        {/* Audience */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <SectionHeader icon="👥" title={t.mi_audience} />
          <div className="space-y-3">
            {audience.primary && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <span className="text-[10px] font-semibold uppercase text-gray-500">{t.mi_audience_primary}</span>
                <p className="mt-1 text-sm font-semibold text-gray-900">{audience.primary}</p>
                {audience.primarySize && (
                  <span className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${sizeBadge(audience.primarySize)}`}>
                    {audience.primarySize === 'Groß' ? t.mi_size_large : audience.primarySize === 'Mittel' ? t.mi_size_medium : t.mi_size_niche}
                  </span>
                )}
              </div>
            )}
            {audience.secondary && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <span className="text-[10px] font-semibold uppercase text-gray-500">{t.mi_audience_secondary}</span>
                <p className="mt-1 text-sm font-semibold text-gray-900">{audience.secondary}</p>
                {audience.secondarySize && (
                  <span className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${sizeBadge(audience.secondarySize)}`}>
                    {audience.secondarySize === 'Groß' ? t.mi_size_large : audience.secondarySize === 'Mittel' ? t.mi_size_medium : t.mi_size_niche}
                  </span>
                )}
              </div>
            )}
            {audience.reach && (
              <div className="rounded-xl border border-gray-100 bg-blue-50/40 p-3">
                <span className="text-[10px] font-semibold uppercase text-blue-600">{t.mi_audience_reach}</span>
                <p className="mt-1 text-xs text-gray-700">{audience.reach}</p>
              </div>
            )}
            {!audience.primary && !audience.secondary && !audience.reach && (
              <p className="text-xs italic text-gray-400">Keine Zielgruppendaten verfügbar.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── SWOT Analysis ───────────────────────────────────────────────────── */}
      {swotSection && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <SectionHeader icon="🧩" title={t.mi_swot} />
          <div className="grid gap-4 md:grid-cols-2">
            {/* Strengths */}
            <div className="rounded-xl border-l-4 border-emerald-400 bg-emerald-50/60 p-4">
              <h4 className="mb-2 text-sm font-bold text-emerald-800">✅ {t.mi_swot_strengths}</h4>
              <ul className="space-y-1">
                {swot.strengths.map((s, i) => (
                  <li key={i} className="text-xs leading-relaxed text-emerald-900">• {s}</li>
                ))}
                {swot.strengths.length === 0 && (
                  <li className="text-xs italic text-emerald-700">Keine Daten.</li>
                )}
              </ul>
            </div>
            {/* Weaknesses */}
            <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50/60 p-4">
              <h4 className="mb-2 text-sm font-bold text-amber-800">⚠️ {t.mi_swot_weaknesses}</h4>
              <ul className="space-y-1">
                {swot.weaknesses.map((s, i) => (
                  <li key={i} className="text-xs leading-relaxed text-amber-900">• {s}</li>
                ))}
                {swot.weaknesses.length === 0 && (
                  <li className="text-xs italic text-amber-700">Keine Daten.</li>
                )}
              </ul>
            </div>
            {/* Opportunities */}
            <div className="rounded-xl border-l-4 border-blue-400 bg-blue-50/60 p-4">
              <h4 className="mb-2 text-sm font-bold text-blue-800">🚀 {t.mi_swot_opportunities}</h4>
              <ul className="space-y-1">
                {swot.opportunities.map((s, i) => (
                  <li key={i} className="text-xs leading-relaxed text-blue-900">• {s}</li>
                ))}
                {swot.opportunities.length === 0 && (
                  <li className="text-xs italic text-blue-700">Keine Daten.</li>
                )}
              </ul>
            </div>
            {/* Threats */}
            <div className="rounded-xl border-l-4 border-red-400 bg-red-50/60 p-4">
              <h4 className="mb-2 text-sm font-bold text-red-800">🛡️ {t.mi_swot_threats}</h4>
              <ul className="space-y-1">
                {swot.threats.map((s, i) => (
                  <li key={i} className="text-xs leading-relaxed text-red-900">• {s}</li>
                ))}
                {swot.threats.length === 0 && (
                  <li className="text-xs italic text-red-700">Keine Daten.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Cross-Selling & Upselling ────────────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Cross-Selling */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <SectionHeader icon="🔄" title={t.mi_cross_sell} />
          {crossSell.length > 0 ? (
            <div className="space-y-3">
              {crossSell.map((cs, i) => {
                const colors = ratingBadge(cs.potential);
                return (
                  <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-gray-900">{cs.product}</p>
                      <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                        {t.mi_cross_potential}: {cs.potential}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{cs.why}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs italic text-gray-400">Keine Cross-Selling-Ideen verfügbar.</p>
          )}
        </div>

        {/* Upselling */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <SectionHeader icon="⬆️" title={t.mi_upsell} />
          {upsell.length > 0 ? (
            <div className="space-y-3">
              {upsell.map((us, i) => (
                <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-sm font-semibold text-gray-900">{us.idea}</p>
                  <p className="mt-1 text-xs text-gray-600">{us.value}</p>
                  <span className="mt-1.5 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                    {t.mi_upsell_premium}: {us.surcharge}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-gray-400">Keine Upselling-Ideen verfügbar.</p>
          )}
        </div>
      </div>

      {/* ── Chancen & Risiken ────────────────────────────────────────────────── */}
      {oppRiskSection && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Biggest Opportunity */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
            <SectionHeader icon="🌟" title={t.mi_biggest_opportunity} />
            {oppRisk.biggestOpportunity && (
              <>
                <p className="text-sm font-semibold text-gray-900">{oppRisk.biggestOpportunity}</p>
                {oppRisk.opportunityProb && (
                  <span className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${probBadge(oppRisk.opportunityProb)}`}>
                    {t.mi_probability}: {oppRisk.opportunityProb}
                  </span>
                )}
              </>
            )}
          </div>

          {/* Biggest Risk */}
          <div className="rounded-2xl border border-red-200 bg-red-50/40 p-6 shadow-sm">
            <SectionHeader icon="⚠️" title={t.mi_biggest_risk} />
            {oppRisk.biggestRisk && (
              <>
                <p className="text-sm font-semibold text-gray-900">{oppRisk.biggestRisk}</p>
                {oppRisk.riskProb && (
                  <span className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${probBadge(oppRisk.riskProb)}`}>
                    {t.mi_probability}: {oppRisk.riskProb}
                  </span>
                )}
                {oppRisk.riskMitigation && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <span className="text-[10px] font-semibold uppercase text-amber-600">{t.mi_risk_mitigation}</span>
                    <p className="mt-1 text-xs text-amber-900">{oppRisk.riskMitigation}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Priorisierte Geschäftsempfehlungen ────────────────────────────────── */}
      {recommendations.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <SectionHeader icon="🎯" title={t.mi_recommendations} />
          <div className="space-y-3">
            {recommendations.map((rec, i) => {
              const colors = priorityBadge(rec.priority);
              const gradients = [
                'from-blue-500 to-purple-600',
                'from-purple-500 to-pink-500',
                'from-pink-400 to-rose-500',
              ];
              return (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <span
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradients[i] ?? gradients[2]} text-sm font-bold text-white shadow-sm`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{rec.title}</p>
                      <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors}`}>
                        {rec.priority === 'Hoch' ? '🔴 Hohe Priorität' : '🟡 Mittlere Priorität'}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-gray-600">{rec.reason}</p>
                    {rec.effect && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        📈 {t.mi_expected_effect}: {rec.effect}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

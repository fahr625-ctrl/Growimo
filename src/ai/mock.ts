import type { ContentRequest, ContentResult, ContentType } from './types';

const MOCK_TEMPLATES: Record<
  ContentType,
  (productIdea: string, tone?: string) => { title: string; body: string }
> = {
  pinterest_pin: (idea) => ({
    title: `[Demo Preview] 5 Ways to Style Your ${idea}`,
    body: `Discover the magic of ${idea} with these creative styling tips! ✨ Whether you're a beginner or a pro, these ideas will transform your space. Tap to save for later! 📌\n\n#${idea.replace(/\s+/g, '')} #DIY #HomeDecor #CreativeIdeas #Inspiration #PinNow #Trending`,
  }),

  etsy_listing: (idea) => ({
    title: `[Demo Preview] Handcrafted ${idea} | Premium Quality | Fast Shipping`,
    body: `Welcome to our shop! This beautiful ${idea} is handcrafted with care and attention to detail.\n\n✨ Features:\n• Premium quality materials\n• Unique, one-of-a-kind design\n• Perfect for gifting or personal use\n• Available in multiple color options\n\nEach ${idea} is made to order and ships within 3-5 business days. Add a touch of charm to your life with this special piece!\n\nTags: ${idea.toLowerCase()}, handmade, gift idea, premium quality, unique design, home decor, artisan craft, boutique, personalized, trendy, aesthetic, minimalist, statement piece`,
  }),

  seo_blog: (idea) => ({
    title: `[Demo Preview] The Ultimate Guide to ${idea}: Everything You Need to Know`,
    body: `Are you looking for the perfect ${idea}? You've come to the right place. In this comprehensive guide, we'll cover everything from choosing the right ${idea} to maximizing its value.\n\n## Why ${idea} Matters\n\nIn today's fast-paced world, having the right ${idea} can make all the difference. Whether you're a seasoned professional or just getting started, understanding the ins and outs of ${idea} is essential for success.\n\n## Top 5 Benefits of ${idea}\n\n1. **Quality and Durability** — A well-chosen ${idea} lasts for years\n2. **Versatility** — Works in multiple scenarios and settings\n3. **Cost-Effectiveness** — Save money by investing in the right ${idea}\n4. **User Satisfaction** — Raving reviews from happy customers\n5. **Style and Aesthetics** — Elevates any environment instantly\n\n## How to Choose the Right ${idea}\n\nWhen selecting your ${idea}, consider these key factors: your specific needs, available space, budget constraints, and desired features. Don't rush the decision — the right ${idea} is worth the research.\n\n## Conclusion\n\n${idea} is more than just a product — it's an investment in quality and satisfaction. Start exploring your options today and discover what a difference the right choice can make!\n\nKeywords: ${idea.toLowerCase()}, best ${idea.toLowerCase()}, ${idea.toLowerCase()} guide, ${idea.toLowerCase()} benefits, choose ${idea.toLowerCase()}, ${idea.toLowerCase()} tips`,
  }),

  social_post: (idea) => ({
    title: `[Demo Preview] ${idea} — Your New Favorite Thing`,
    body: `Version 1 (Instagram):\nObsessed with this ${idea}! 😍 It's literally changed the game. If you haven't tried it yet, what are you waiting for? Link in bio! 🔥\n#${idea.replace(/\s+/g, '')} #MustHave #GameChanger #Obsessed\n\nVersion 2 (Twitter/X):\nJust got my hands on ${idea} and WOW. 🤯 This is the kind of quality we need more of. Highly recommend checking this out!\n#${idea.replace(/\s+/g, '')} #Review #Recommended\n\nVersion 3 (Facebook):\nHey everyone! I wanted to share something exciting — I recently discovered ${idea} and it's absolutely amazing! The quality is outstanding and it's made such a difference in my daily routine. Drop a comment if you've tried it too! 💬✨`,
  }),

  email_newsletter: (idea) => ({
    title: `[Demo Preview] You won't believe what ${idea} can do for you...`,
    body: `Hi there,\n\nWe're thrilled to introduce you to something special — ${idea}, the product that's been making waves and turning heads.\n\nHere's why people are falling in love with ${idea}:\n\n• Unmatched Quality — Every ${idea} is crafted with premium materials and obsessive attention to detail\n• Incredible Value — Get premium quality without the premium price tag\n• Rave Reviews — Our customers can't stop talking about their experience\n\nReady to experience ${idea} for yourself? Click below to learn more and grab yours before they're gone!\n\n👉 [Shop ${idea} Now]\n\nDon't wait — our community is growing fast, and we'd love for you to be part of it.\n\nWith excitement,\nThe Growimo Team\n\nP.S. — Use code WELCOME10 for 10% off your first ${idea}!`,
  }),

  marketing_plan: (idea) => ({
    title: `[Demo Preview] Marketing Strategy for ${idea}`,
    body: `## Target Audience\n\nPrimary: 25-45 year old professionals who value quality and convenience.\nSecondary: Gift shoppers looking for unique, high-quality items.\n\n## Unique Selling Proposition\n\n${idea} stands out through its combination of premium craftsmanship, affordable pricing, and exceptional customer experience.\n\n## Marketing Channels\n\n1. **Pinterest** — Create 15-20 pins per week showcasing ${idea} in lifestyle settings\n2. **Instagram** — Daily posts + Stories featuring user-generated content and behind-the-scenes\n3. **Email Marketing** — Weekly newsletter with tips, promotions, and community highlights\n4. **SEO Blog** — Publish 2 articles per week targeting ${idea.toLowerCase()}-related keywords\n5. **Etsy/E-commerce** — Optimize listings with high-ranking search terms and professional photos\n\n## Content Strategy\n\nWeek 1-2: Awareness — Educational content about ${idea} benefits\nWeek 3-4: Consideration — Comparison guides and testimonials\nWeek 5+: Conversion — Limited-time offers and social proof campaigns\n\n## Launch Timeline (4 Weeks)\n\nWeek 1: Social media tease campaign + Influencer outreach\nWeek 2: Pre-launch email list building + Landing page live\nWeek 3: Official launch + PR push + Paid ads begin\nWeek 4: Customer review campaign + Retargeting ads\n\n## Key Metrics\n\n• Social media engagement rate\n• Email open and click-through rates\n• Website conversion rate\n• Customer acquisition cost\n• Monthly recurring revenue\n\n## Budget Recommendations\n\nAllocate 60% to paid social ads, 20% to influencer partnerships, 15% to content creation, and 5% to tools/software.`,
  }),

  product_idea: (idea) => ({
    title: `[Demo Preview] ${idea} — Product Concept Brief`,
    body: `## Product Overview\n\n${idea} is a premium solution designed to solve a real problem for modern consumers. It combines quality, style, and functionality in a way that existing products on the market simply don't match.\n\n## Target Market\n\n• Primary: Millennials and Gen Z consumers (22-40) seeking quality and authenticity\n• Secondary: Gift buyers looking for unique, memorable presents\n• Market size: Growing segment with 15% YoY increase in demand\n\n## Key Features\n\n1. Premium materials sourced sustainably\n2. Intuitive design requiring no learning curve\n3. Customizable options to match personal style\n4. Durable construction built to last\n5. Eco-friendly packaging\n\n## Competitive Advantage\n\nUnlike existing alternatives, ${idea} offers a unique combination of premium quality at an accessible price point, backed by exceptional customer service and a growing community of loyal users.\n\n## Monetization Strategy\n\n• Direct-to-consumer sales via e-commerce\n• Subscription option for repeat purchases\n• Limited edition seasonal releases\n• Affiliate and wholesale partnerships\n\n## Development Considerations\n\n• Prototype and testing phase: 6-8 weeks\n• Initial production run: MOQ 500 units\n• Quality control and certification requirements\n• Packaging design and sourcing\n\n## Go-to-Market Suggestions\n\nLaunch with a 30-day social media campaign building anticipation, followed by an exclusive early-access period for waitlist subscribers, then a full public launch with PR outreach.`,
  }),

  trend_insight: (idea) => ({
    title: `[Demo Preview] Market Trends Shaping the ${idea} Industry`,
    body: `## Current Market Trends\n\n1. **Premiumization** — Consumers are trading up, willing to pay more for higher-quality ${idea} products\n2. **Sustainability Focus** — Eco-friendly materials and ethical production are becoming table stakes\n3. **Personalization** — Custom and made-to-order ${idea} options are seeing 40% higher engagement\n4. **Social Commerce** — Pinterest and Instagram are driving 60% of discovery for ${idea}-type products\n5. **Direct-to-Consumer Shift** — Brands are bypassing traditional retail for higher margins and customer data\n\n## Consumer Behavior Shifts\n\nToday's buyers research extensively before purchasing. They read reviews, compare options, and expect transparency about materials and production. The "experience economy" means buyers value the story behind ${idea} almost as much as the product itself.\n\n## Competitor Activity\n\nThe ${idea} space is seeing increased competition from both established brands expanding their lines and new DTC startups. Key differentiators include design innovation, price positioning, and community building.\n\n## Growth Opportunities\n\n• Untapped international markets showing growing demand\n• B2B/corporate gifting segment is under-served\n• Subscription and replenishment models for repeat purchases\n• Content and education platforms as a complementary revenue stream\n\n## Potential Threats\n\n• Rising material and shipping costs\n• Increasing customer acquisition costs on paid channels\n• Copycat products from lower-cost competitors\n\n## Strategic Recommendations\n\nFocus on building a strong brand community, invest in SEO and organic content, differentiate through design and sustainability, and develop a multi-channel strategy that reduces dependency on any single platform.`,
  }),

  market_intelligence: (idea) => ({
    title: `[Demo Preview] Marktintelligenz für ${idea}`,
    body: `## Marktüberblick

${idea} bewegt sich in einem dynamischen Markt mit wachsender Nachfrage nach hochwertigen, authentischen und nachhaltig produzierten Angeboten. Kundinnen und Kunden vergleichen zunehmend Preise, Bewertungen und den konkreten Mehrwert, bevor sie kaufen.

## Zielgruppen & Bedürfnisse

Die Kernzielgruppe sucht eine verlässliche Lösung, die Alltag, Stil und Qualität verbindet. Besonders relevant sind Transparenz, einfache Kaufentscheidungen und ein überzeugendes Preis-Leistungs-Verhältnis. Eine sekundäre Zielgruppe besteht aus Geschenk- und Wiederholungskäufern.

## Wettbewerbsumfeld

Der Wettbewerb reicht von etablierten Marken bis zu spezialisierten Direct-to-Consumer-Anbietern. Sichtbare Differenzierung entsteht durch klare Positionierung, glaubwürdige Kundenstimmen, starke Produktbilder und hilfreiche Inhalte. Preis allein ist selten ein nachhaltiger Vorteil.

## Chancen

• Longtail-SEO für konkrete Anwendungsfälle und Kaufabsichten
• Social Commerce über Pinterest, Instagram und Kurzvideos
• Personalisierte Varianten, Bundles und saisonale Angebote
• Kooperationen mit passenden Creators und Nischen-Communities

## Risiken & Empfehlungen

Steigende Werbekosten, leicht kopierbare Konzepte und Lieferengpässe können Margen und Wachstum belasten. Teste zuerst mehrere Botschaften und Zielgruppen mit kleinen Budgets, beobachte Conversion-Rate, Warenkorbhöhe und Wiederkaufsrate und skaliere anschließend die erfolgreichsten Kanäle. Baue parallel eine eigene E-Mail-Liste auf, um unabhängiger von Plattform-Algorithmen zu werden.`,
  }),

  marketing_analysis: (idea) => ({
    title: `KI-Analyse & Optimierung`,
    body: `1. SEO-Score
Punktzahl: 72/100
Begründung: Das Produkt "${idea}" hat gutes SEO-Potenzial mit spezifischen Longtail-Keywords. Die Nische ist wettbewerbsfähig, aber mit gezielter Content-Strategie gut erreichbar. Verbesserungspotenzial besteht bei der technischen Optimierung und der Content-Tiefe.

2. Pinterest-Potenzial
Bewertung: Hoch
Verbesserungsvorschläge: 1. Vertikale Pins im 2:3-Format mit Text-Overlay erstellen. 2. Saisonale Boards anlegen und regelmäßig pinnen. 3. Rich Pins aktivieren für bessere Sichtbarkeit.

3. Etsy-Potenzial
Bewertung: Mittel
Begründung: Etsy ist der natürliche Marktplatz für handgefertigte und individuelle Produkte. Die Plattform hat hohe Glaubwürdigkeit bei der Zielgruppe. Der Wettbewerb ist jedoch stark, daher sind exzellente Fotos und SEO-optimierte Listings entscheidend.

4. Verkaufswahrscheinlichkeit
Bewertung: Hoch
Optimierungstipps: 1. Professionelle Produktfotos mit Lifestyle-Kontext erstellen lassen. 2. Social Proof durch Kundenbewertungen aufbauen. 3. Cross-Selling-Angebote im Listing integrieren.

5. Lesbarkeit & emotionale Wirkung
Punktzahl: 85/100
Analyse: Die Texte sind flüssig lesbar und sprechen die Zielgruppe emotional an. Der Lesefluss ist angenehm, die Tonalität passt zur Marke. Leichte Verbesserungen sind bei der Satzlänge und der Variation des Satzbaus möglich.

6. Keyword-Abdeckung
Punktzahl: 68/100
Fehlende Longtail-Keywords: handgefertigte Geschenkideen, personalisierte Produkte online, nachhaltige Wohnaccessoires, minimalistische Deko handmade, hochwertige Materialien Shop, Unikate kaufen, individuelle Anfertigung, Wohnaccessoires Trend

7. Konkurrenzniveau
Bewertung: Mittel
Analyse: Der Markt ist gut besetzt, aber nicht übersättigt. Es gibt etablierte Anbieter, jedoch auch Raum für neue Marken mit klarem Profil. Die Differenzierung über Design und Branding ist der Schlüssel zum Erfolg.

8. Call-to-Action-Qualität
Punktzahl: 70/100
Verbesserungsvorschlag: "Jetzt dein Unikat sichern – nur noch wenige verfügbar" statt allgemeiner Formulierungen für mehr Dringlichkeit und Exklusivität.

9. Priorisierte To-do-Liste
1. Keyword-Recherche mit Tools wie Ubersuggest oder Ahrefs durchführen und Top-20-Keywords identifizieren
2. Professionelle Produktfotos in verschiedenen Settings erstellen lassen (mindestens 10–15 Bilder)
3. Pinterest-Business-Account einrichten und erste 20 Pins planen und veröffentlichen
4. Etsy-Shop mit vollständig ausgefüllten Profilen, Policies und optimierten Listings eröffnen
5. Content-Kalender für die ersten 4 Wochen mit Blog- und Social-Media-Themen erstellen

10. Gesamtbewertung
Punktzahl: 74/100
Zusammenfassung: Das Produkt "${idea}" hat insgesamt gutes Marktpotenzial mit soliden SEO- und Content-Grundlagen. Die visuelle Vermarktung über Pinterest und Etsy bietet konkrete Wachstumschancen. Die oberste Empfehlung ist, jetzt in hochwertige Produktfotos und eine fokussierte Keyword-Strategie zu investieren, um die Sichtbarkeit deutlich zu erhöhen.`,
  }),
};

export function generateMockContent(request: ContentRequest): ContentResult {
  const template = MOCK_TEMPLATES[request.contentType];
  const { title, body } = template(request.productIdea, request.tone);

  const baseMetadata: Record<string, unknown> = {
    generatedBy: 'mock',
    timestamp: new Date().toISOString(),
  };

  // Parse analysis metadata for the dashboard
  if (request.contentType === 'marketing_analysis') {
    const extractScore = (label: string) => {
      const m = body.match(new RegExp(`${label}[:\\s]*Punktzahl:\\s*(\\d+)/100`, 'i'));
      return m ? parseInt(m[1]) : null;
    };
    const extractRating = (label: string) => {
      const m = body.match(new RegExp(`${label}[:\\s]*Bewertung:\\s*(Hoch|Mittel|Niedrig)`, 'i'));
      return m ? m[1] : null;
    };

    return {
      contentType: request.contentType,
      title,
      body,
      metadata: {
        ...baseMetadata,
        seoScore: extractScore('SEO-Score'),
        readabilityScore: extractScore('Lesbarkeit'),
        keywordScore: extractScore('Keyword-Abdeckung'),
        ctaScore: extractScore('Call-to-Action'),
        overallScore: extractScore('Gesamtbewertung'),
        pinterestPotential: extractRating('Pinterest-Potenzial'),
        etsyPotential: extractRating('Etsy-Potenzial'),
        salesProbability: extractRating('Verkaufswahrscheinlichkeit'),
        competitionLevel: extractRating('Konkurrenzniveau'),
      },
    };
  }

  return {
    contentType: request.contentType,
    title,
    body,
    metadata: baseMetadata,
  };
}

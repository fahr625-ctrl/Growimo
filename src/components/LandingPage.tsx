import { useState } from "react";
import { useTranslation } from "~/i18n";
import LanguageSwitcher from "~/components/LanguageSwitcher";
// ── Teil B der Neuausrichtung (Owner-Vorgabe 2026-11-12) ───────────────────────
// Die Startseite verspricht nur, was gebaut ist: Pinterest-Texte, Etsy-Texte und
// TikTok-Skript sind fertig; Pin-Bild und Etsy-Mockup sind ausdrücklich als
// „in Entwicklung" gekennzeichnet. Keine erfundenen Zahlen, keine erfundene
// Social Proof. Die alten Landing-Keys bleiben in de.ts/en.ts erhalten
// (ausblenden statt löschen) — diese Seite nutzt die lp_*-Familie.

// ── Icons ───────────────────────────────────────────────────────────────────────

function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ChevronDownIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ClockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function InfoIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ── Shared UI primitives ────────────────────────────────────────────────────────

function SectionContainer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl ${className}`}>
      {children}
    </h2>
  );
}

function StatusBadge({ tone, children }: { tone: "ready" | "partial" | "soon"; children: React.ReactNode }) {
  const styles =
    tone === "ready"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "partial"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-gray-100 text-gray-600 ring-gray-200";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${styles}`}>
      {tone === "soon" && <ClockIcon className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

// ── NAV ─────────────────────────────────────────────────────────────────────────

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useTranslation();

  const navLinks = [
    { label: t.lp_nav_features, href: "#funktionen" },
    { label: t.lp_nav_examples, href: "#beispiele" },
    { label: t.lp_nav_how, href: "#so-gehts" },
    { label: t.lp_nav_faq, href: "#fragen" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-xl">
      <div
        className="mx-auto flex max-w-6xl items-center justify-between pl-4 pr-3 sm:pl-6 sm:pr-6 lg:px-8"
        style={{ minHeight: "72px" }}
      >
        <a href="#" className="flex flex-shrink-0 items-center">
          <img src="/logo.png" alt="Growimo" className="h-11 w-auto sm:h-14" />
        </a>

        <div className="hidden items-center gap-1 lg:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-xl px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-blue-600"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <LanguageSwitcher />
          <a href="/app/sign-in" className="text-sm font-medium text-gray-600 transition-colors hover:text-blue-600">
            {t.header_login}
          </a>
          <a
            href="/app/sign-up"
            className="inline-flex items-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-gray-800"
          >
            {t.header_cta}
          </a>
        </div>

        <div className="flex items-center lg:hidden">
          <button
            className="rounded-xl p-2.5 text-gray-600 hover:bg-gray-100"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={t.nav_menu_toggle}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-gray-100 bg-white px-4 pb-4 pt-2 lg:hidden">
          <div className="mb-3 flex justify-center">
            <LanguageSwitcher />
          </div>
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-blue-600"
              >
                {link.label}
              </a>
            ))}
            <hr className="my-2 border-gray-100" />
            <a
              href="/app/sign-in"
              onClick={() => setMenuOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              {t.header_login}
            </a>
            <a
              href="/app/sign-up"
              onClick={() => setMenuOpen(false)}
              className="mt-1 rounded-xl bg-gray-900 px-5 py-3 text-center text-sm font-semibold text-white shadow-md"
            >
              {t.header_cta}
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

// ── HERO ────────────────────────────────────────────────────────────────────────

function HeroSection() {
  const { t } = useTranslation();

  const points = [t.lp_hero_point1, t.lp_hero_point2, t.lp_hero_point3];

  return (
    <section id="hero" className="relative overflow-hidden pt-28 pb-20 sm:pt-36 sm:pb-28">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 h-[700px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-blue-50 via-purple-50/40 to-transparent opacity-60 blur-3xl" />
      </div>

      <SectionContainer>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="max-w-xl">
            <div className="mb-8 inline-flex items-center rounded-full border border-blue-200/60 bg-white/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-blue-600 backdrop-blur-sm">
              {t.lp_hero_badge}
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:leading-[1.1]">
              {t.lp_hero_headline}
            </h1>

            <p className="mt-6 text-lg leading-relaxed text-gray-500 sm:text-xl">{t.lp_hero_sub}</p>

            <ul className="mt-8 space-y-3">
              {points.map((point) => (
                <li key={point} className="flex items-start gap-3">
                  <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
                  <span className="text-base text-gray-700">{point}</span>
                </li>
              ))}
            </ul>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="/app/sign-up"
                className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-gray-900/10 transition-all hover:bg-gray-800 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
              >
                {t.lp_hero_cta_primary}
              </a>
              <a
                href="#beispiele"
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-8 py-4 text-base font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50 hover:-translate-y-0.5"
              >
                {t.lp_hero_cta_secondary}
              </a>
            </div>

            <p className="mt-6 text-sm text-gray-400">{t.lp_hero_note}</p>
          </div>

          {/* Beispiel-Karte: echte Ausgabeform, ohne erfundene Kennzahlen */}
          <div className="relative">
            <div className="absolute inset-0 -m-6 rounded-3xl bg-gradient-to-br from-blue-400/10 via-purple-400/5 to-transparent blur-2xl" />
            <div className="relative rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xl shadow-gray-900/5 sm:p-7">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {t.lp_hero_card_label}
              </p>
              <h2 className="mt-3 text-lg font-bold leading-snug text-gray-900 sm:text-xl">
                {t.lp_hero_card_title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-gray-500">{t.lp_hero_card_desc}</p>
              <p className="mt-3 text-xs text-gray-400">{t.lp_hero_card_meta}</p>

              {/* Kein erfundenes Beispielbild — nur was wirklich geliefert wird */}
              <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-4 text-xs font-medium text-emerald-800">
                <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{t.lp_hero_card_image_note}</span>
              </div>
            </div>
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── DIE DREI INHALTE ────────────────────────────────────────────────────────────

function FeaturesSection() {
  const { t } = useTranslation();

  const features = [
    {
      icon: "📌",
      title: t.lp_feature_pinterest_title,
      desc: t.lp_feature_pinterest_desc,
      status: t.lp_feature_pinterest_status,
      tone: "partial" as const,
      tile: "from-rose-500 to-red-500",
    },
    {
      icon: "🛍️",
      title: t.lp_feature_etsy_title,
      desc: t.lp_feature_etsy_desc,
      status: t.lp_feature_etsy_status,
      tone: "partial" as const,
      tile: "from-amber-500 to-orange-500",
    },
    {
      icon: "🎬",
      title: t.lp_feature_tiktok_title,
      desc: t.lp_feature_tiktok_desc,
      status: t.lp_feature_tiktok_status,
      tone: "ready" as const,
      tile: "from-emerald-500 to-teal-500",
    },
  ];

  return (
    <section id="funktionen" className="bg-gray-50 py-20 sm:py-28">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.lp_features_headline}</SectionHeading>
          <p className="mt-4 text-base text-gray-500 sm:text-lg">{t.lp_features_sub}</p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-2xl shadow-sm ${f.tile}`}
              >
                {f.icon}
              </div>
              <h3 className="mt-4 text-lg font-bold text-gray-900">{f.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">{f.desc}</p>
              <div className="mt-5">
                <StatusBadge tone={f.tone}>{f.status}</StatusBadge>
              </div>
            </div>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── BEISPIELE ───────────────────────────────────────────────────────────────────

function ExampleCard({
  label,
  children,
  footer,
  footerTone = "soon",
}: {
  label: string;
  children: React.ReactNode;
  footer: string;
  footerTone?: "ready" | "soon";
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="mt-4 flex-1 space-y-4">{children}</div>
      <div className="mt-5 border-t border-gray-100 pt-4">
        <StatusBadge tone={footerTone}>{footer}</StatusBadge>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-sm leading-relaxed text-gray-700 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function ExamplesSection() {
  const { t } = useTranslation();

  const split = (value: string) =>
    value
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);

  const pinKeywords = split(t.lp_ex_pin_kw);
  const etsyTags = split(t.lp_ex_etsy_tags);
  const ttScenes = split(t.lp_ex_tt_scenes);
  const ttHashtags = split(t.lp_ex_tt_hashtags);

  return (
    <section id="beispiele" className="py-20 sm:py-28">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.lp_examples_headline}</SectionHeading>
          <p className="mt-4 text-base text-gray-500 sm:text-lg">{t.lp_examples_sub}</p>
        </div>

        <div className="mx-auto mt-10 max-w-2xl">
          <div className="rounded-2xl border border-blue-200 border-l-4 border-l-blue-500 bg-white p-5 shadow-sm">
            <p className="text-sm italic leading-relaxed text-gray-700">{t.lp_examples_input}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {/* Pinterest */}
          <ExampleCard label={t.lp_ex_pin_label} footer={t.lp_ex_pin_soon}>
            <Field label={t.lp_ex_pin_title_label} value={t.lp_ex_pin_title} />
            <Field label={t.lp_ex_pin_desc_label} value={t.lp_ex_pin_desc} />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.lp_ex_pin_kw_label}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {pinKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200/60"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          </ExampleCard>

          {/* Etsy */}
          <ExampleCard label={t.lp_ex_etsy_label} footer={t.lp_ex_etsy_soon}>
            <Field label={t.lp_ex_etsy_title_label} value={t.lp_ex_etsy_title} />
            <Field label={t.lp_ex_etsy_desc_label} value={t.lp_ex_etsy_desc} />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.lp_ex_etsy_tags_label}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {etsyTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </ExampleCard>

          {/* TikTok */}
          <ExampleCard label={t.lp_ex_tt_label} footer={t.lp_ex_tt_ready} footerTone="ready">
            <Field label={t.lp_ex_tt_title_label} value={t.lp_ex_tt_title} />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.lp_ex_tt_scenes_label}</p>
              <ul className="mt-1.5 space-y-1.5">
                {ttScenes.map((scene) => (
                  <li key={scene} className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs leading-relaxed text-gray-700">
                    {scene}
                  </li>
                ))}
              </ul>
            </div>
            <Field label={t.lp_ex_tt_caption_label} value={t.lp_ex_tt_caption} />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {t.lp_ex_tt_hashtags_label}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ttHashtags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </ExampleCard>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── KAMPAGNE ────────────────────────────────────────────────────────────────────

function KampagneSection() {
  const { t } = useTranslation();

  const points = [
    { title: t.lp_kar_p1_title, text: t.lp_kar_p1_text },
    { title: t.lp_kar_p2_title, text: t.lp_kar_p2_text },
    { title: t.lp_kar_p3_title, text: t.lp_kar_p3_text },
    { title: t.lp_kar_p4_title, text: t.lp_kar_p4_text },
  ];

  return (
    <section id="kampagne" className="py-20 sm:py-28">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.lp_kar_headline}</SectionHeading>
          <p className="mt-4 text-base text-gray-500 sm:text-lg">{t.lp_kar_sub}</p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {points.map((point) => (
            <div key={point.title} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="flex items-start gap-2 text-base font-bold leading-snug text-gray-900">
                <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
                <span>{point.title}</span>
              </h3>
              <p className="mt-2 pl-7 text-sm leading-relaxed text-gray-500">{point.text}</p>
            </div>
          ))}
        </div>

        {/* Ehrlich benannt: kein automatisches Veröffentlichen */}
        <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-blue-200 bg-blue-50/70 p-6 sm:p-8">
          <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <InfoIcon className="h-4 w-4 flex-shrink-0 text-blue-600" />
            {t.lp_kar_note_title}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{t.lp_kar_note_text}</p>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── SO FUNKTIONIERT'S ───────────────────────────────────────────────────────────

function HowItWorksSection() {
  const { t } = useTranslation();

  const steps = [
    { number: "1", title: t.lp_how_step1_title, text: t.lp_how_step1_text },
    { number: "2", title: t.lp_how_step2_title, text: t.lp_how_step2_text },
    { number: "3", title: t.lp_how_step3_title, text: t.lp_how_step3_text },
  ];

  return (
    <section id="so-gehts" className="bg-gray-50 py-20 sm:py-28">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.lp_how_headline}</SectionHeading>
        </div>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {steps.map((step, idx) => (
            <div key={step.number} className="relative text-center">
              {idx < steps.length - 1 && (
                <div className="absolute left-[60%] top-9 hidden h-0.5 w-full bg-gradient-to-r from-blue-200 via-purple-200 to-transparent sm:block" />
              )}
              <div className="relative mx-auto flex h-18 w-18 items-center justify-center rounded-2xl bg-gray-900 text-2xl font-extrabold text-white shadow-lg">
                {step.number}
              </div>
              <h3 className="mt-5 text-lg font-bold text-gray-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{step.text}</p>
            </div>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── WAS NOCH IN ENTWICKLUNG IST ─────────────────────────────────────────────────

function SoonSection() {
  const { t } = useTranslation();

  return (
    <section id="in-entwicklung" className="py-20 sm:py-28">
      <SectionContainer>
        <div className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50/60 p-8 sm:p-12">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ClockIcon className="h-5 w-5" />
            </span>
            <h2 className="text-xl font-extrabold text-gray-900 sm:text-2xl">{t.lp_soon_headline}</h2>
          </div>
          <ul className="mt-6 space-y-4">
            <li className="flex items-start gap-3">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
              <span className="text-sm leading-relaxed text-gray-700">{t.lp_soon_pinterest}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
              <span className="text-sm leading-relaxed text-gray-700">{t.lp_soon_etsy}</span>
            </li>
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-gray-500">{t.lp_soon_note}</p>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────────────

function FaqSection() {
  const { t } = useTranslation();

  const faqs = [
    { q: t.lp_faq_q1, a: t.lp_faq_a1 },
    { q: t.lp_faq_q2, a: t.lp_faq_a2 },
    { q: t.lp_faq_q3, a: t.lp_faq_a3 },
    { q: t.lp_faq_q4, a: t.lp_faq_a4 },
    { q: t.lp_faq_q5, a: t.lp_faq_a5 },
    { q: t.lp_faq_q6, a: t.lp_faq_a6 },
    { q: t.lp_faq_q7, a: t.lp_faq_a7 },
  ];

  return (
    <section id="fragen" className="bg-gray-50 py-20 sm:py-28">
      <SectionContainer>
        <div className="mx-auto max-w-3xl text-center">
          <SectionHeading>{t.lp_faq_headline}</SectionHeading>
        </div>
        <div className="mx-auto mt-12 max-w-3xl space-y-3">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:border-blue-200 open:border-blue-200 open:shadow-sm sm:p-6"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-semibold text-gray-900 marker:content-none">
                {faq.q}
                <ChevronDownIcon className="h-5 w-5 flex-shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">{faq.a}</p>
            </details>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── ABSCHLUSS-CTA ───────────────────────────────────────────────────────────────

function FinalCtaSection() {
  const { t } = useTranslation();

  return (
    <section className="py-20 sm:py-28">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.lp_cta_headline}</SectionHeading>
          <p className="mt-4 text-base text-gray-500 sm:text-lg">{t.lp_cta_text}</p>
          <div className="mt-9">
            <a
              href="/app/sign-up"
              className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-gray-900/10 transition-all hover:bg-gray-800 hover:-translate-y-0.5"
            >
              {t.lp_cta_button}
            </a>
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── FOOTER ──────────────────────────────────────────────────────────────────────

function Footer() {
  const { t } = useTranslation();

  const featureLinks = [
    { label: t.lp_nav_features, href: "#funktionen" },
    { label: t.lp_nav_examples, href: "#beispiele" },
    { label: t.lp_nav_how, href: "#so-gehts" },
    { label: t.lp_nav_faq, href: "#fragen" },
  ];

  const legalLinks = [
    { label: t.footer_imprint, href: "/impressum" },
    { label: t.footer_privacy, href: "/datenschutz" },
    { label: t.footer_agb, href: "/agb" },
    { label: t.footer_widerruf, href: "/widerruf" },
    { label: t.footer_contact, href: "/impressum" },
  ];

  return (
    <footer className="border-t border-gray-200 bg-white py-12">
      <SectionContainer>
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="Growimo" className="h-8 w-auto" />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-gray-500">{t.lp_footer_description}</p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900">{t.footer_features}</h4>
            <ul className="mt-4 space-y-2">
              {featureLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-sm text-gray-500 transition-colors hover:text-blue-600">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900">{t.footer_legal}</h4>
            <ul className="mt-4 space-y-2">
              {legalLinks.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-sm text-gray-500 transition-colors hover:text-blue-600">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-gray-100 pt-6">
          <p className="text-xs leading-relaxed text-gray-400">{t.lp_footer_disclaimer}</p>
          <p className="mt-4 text-sm text-gray-400">{t.footer_copyright}</p>
        </div>
      </SectionContainer>
    </footer>
  );
}

// ── LANDING PAGE ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] bg-[length:24px_24px]">
      <NavBar />
      <HeroSection />
      <FeaturesSection />
      <ExamplesSection />
      <KampagneSection />
      <HowItWorksSection />
      <SoonSection />
      <FaqSection />
      <FinalCtaSection />
      <Footer />
    </div>
  );
}

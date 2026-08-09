import { useState } from "react";
import { useTranslation } from "~/i18n";
import LanguageSwitcher from "~/components/LanguageSwitcher";

// ── Icons (kept minimal, reused) ────────────────────────────────────────────────

function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CrossIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
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

// ── Shared UI primitives ────────────────────────────────────────────────────────

function SectionContainer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}

function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl ${className}`}>
      {children}
    </h2>
  );
}

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-xl hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      {children}
    </a>
  );
}

function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-6 py-3.5 text-base font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-200 hover:bg-gray-50 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
    >
      {children}
    </a>
  );
}

// ── NAV ─────────────────────────────────────────────────────────────────────────

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useTranslation();

  const navLinks = [
    { label: t.nav_features, href: "#features" },
    { label: t.nav_how_it_works, href: "#how-it-works" },
    { label: t.nav_examples, href: "#examples" },
    { label: t.nav_audience, href: "#audience" },
    { label: t.nav_faq, href: "#faq" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between pl-6 pr-3 sm:pl-8 sm:pr-6 lg:px-8"
           style={{ minHeight: '72px' }}>
        {/* Logo */}
        <a href="#" className="flex items-center flex-shrink-0">
          <img
            src="/logo.png"
            alt="Growimo"
            className="h-11 sm:h-14 w-auto"
          />
        </a>

        {/* Desktop nav links */}
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

        {/* Desktop right side */}
        <div className="hidden items-center gap-3 lg:flex">
          <LanguageSwitcher />
          <a href="/app/sign-in" className="text-sm font-medium text-gray-600 transition-colors hover:text-blue-600">
            {t.header_login}
          </a>
          <a
            href="/app/sign-up"
            className="inline-flex items-center rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-200 transition-all hover:from-blue-700 hover:to-purple-700 hover:shadow-lg"
          >
            {t.header_cta}
          </a>
        </div>

        {/* Mobile: hamburger only — LanguageSwitcher moved into menu */}
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

      {/* Mobile menu panel — includes LanguageSwitcher */}
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
              className="mt-1 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3 text-center text-sm font-semibold text-white shadow-md"
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

function PlayIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function HeroSection() {
  const { t } = useTranslation();

  return (
    <section id="hero" className="relative overflow-hidden pt-20 pb-24 sm:pt-44 sm:pb-32">
      {/* Background glow */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[800px] rounded-full bg-gradient-to-b from-blue-50 via-purple-50/40 to-transparent opacity-60 blur-3xl" />
        <div className="absolute top-20 right-0 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-purple-100/60 to-blue-50/40 opacity-40 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-blue-50 to-transparent opacity-30 blur-3xl" />
      </div>

      <SectionContainer>
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-24">
          {/* Left: text */}
          <div className="max-w-xl">
            {/* Badge */}
            <div className="mb-10 inline-flex items-center rounded-full border border-blue-200/60 bg-white/80 px-5 py-2 text-sm font-semibold text-blue-600 backdrop-blur-sm">
              {t.hero_badge}
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl lg:leading-[1.1]">
              {t.hero_headline}
            </h1>

            <p className="mt-8 text-xl leading-relaxed text-gray-500 sm:text-2xl max-w-lg">
              {t.hero_subtitle_new}
            </p>

            {/* Benefit bullets */}
            <ul className="mt-8 space-y-3">
              <li className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
                <span className="text-base text-gray-700 sm:text-lg">{t.hero_benefit1}</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
                <span className="text-base text-gray-700 sm:text-lg">{t.hero_benefit2}</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
                <span className="text-base text-gray-700 sm:text-lg">{t.hero_benefit3}</span>
              </li>
            </ul>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <a
                href="/app/sign-up"
                className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-8 py-4 text-lg font-semibold text-white sm:text-base shadow-lg shadow-gray-900/10 transition-all hover:bg-gray-800 hover:shadow-xl hover:shadow-gray-900/15 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
              >
                {t.hero_cta_primary}
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-8 py-4 text-lg font-semibold text-gray-700 sm:text-base shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
              >
                <PlayIcon className="h-4 w-4" />
                {t.hero_cta_secondary}
              </a>
            </div>

            <p className="mt-8 text-sm text-gray-400">
              {t.hero_trust}
            </p>
          </div>

          {/* Right: Premium dashboard mockup */}
          <div className="relative hidden lg:block">
            <div className="relative">
              {/* Glow behind mockup */}
              <div className="absolute inset-0 -m-8 rounded-3xl bg-gradient-to-br from-blue-400/10 via-purple-400/5 to-transparent blur-2xl" />

              {/* Main dashboard card */}
              <div className="relative rounded-2xl border border-gray-200/80 bg-white shadow-2xl shadow-gray-900/5 overflow-hidden">
                {/* Mock header bar */}
                <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
                  <div className="flex gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="ml-2 h-4 w-32 rounded-md bg-gray-100" />
                  <div className="ml-auto flex gap-2">
                    <div className="h-6 w-6 rounded-md bg-gray-100" />
                    <div className="h-6 w-6 rounded-md bg-gray-100" />
                  </div>
                </div>

                {/* Mock sidebar + content layout */}
                <div className="flex">
                  {/* Sidebar */}
                  <div className="w-40 border-r border-gray-100 px-3 py-4 space-y-2">
                    <div className="h-3 w-16 rounded-full bg-blue-100" />
                    <div className="h-2 w-20 rounded-full bg-gray-100" />
                    <div className="h-2 w-24 rounded-full bg-gray-100" />
                    <div className="h-2 w-14 rounded-full bg-gray-100" />
                    <div className="mt-4 h-3 w-12 rounded-full bg-gray-200" />
                    <div className="h-2 w-20 rounded-full bg-gray-100" />
                    <div className="h-2 w-16 rounded-full bg-gray-100" />
                  </div>

                  {/* Main content */}
                  <div className="flex-1 p-5 space-y-4">
                    {/* KPI cards row */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { growth: '+24%', label: 'Content', color: 'bg-blue-50 text-blue-600' },
                        { growth: '+18%', label: 'SEO Score', color: 'bg-purple-50 text-purple-600' },
                        { growth: '+32%', label: 'Traffic', color: 'bg-emerald-50 text-emerald-600' },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                          <div className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold ${stat.color}`}>
                            {stat.growth}
                          </div>
                          <div className="mt-2 text-[11px] font-medium text-gray-400">{stat.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Chart area */}
                    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <div className="h-3 w-24 rounded-full bg-gray-100" />
                        <div className="flex gap-1.5">
                          <div className="h-5 w-12 rounded-md bg-blue-100" />
                          <div className="h-5 w-12 rounded-md bg-gray-100" />
                        </div>
                      </div>
                      {/* Bar chart */}
                      <div className="flex items-end gap-2 h-24">
                        {[35, 55, 42, 78, 60, 90, 72, 85, 48, 65, 80, 95].map((h, i) => (
                          <div
                            key={i}
                            className="flex-1 rounded-t-md bg-gradient-to-t from-blue-500 to-blue-400 transition-all"
                            style={{ height: `${h}%` }}
                          />
                        ))}
                      </div>
                      <div className="mt-2 flex justify-between">
                        {['Jan','Mar','May','Jul','Sep','Nov'].map((m) => (
                          <span key={m} className="text-[10px] text-gray-300">{m}</span>
                        ))}
                      </div>
                    </div>

                    {/* Bottom cards */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm space-y-2">
                        <div className="h-2 w-16 rounded-full bg-gray-100" />
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500" />
                          <div className="space-y-1 flex-1">
                            <div className="h-2 w-3/4 rounded-full bg-gray-100" />
                            <div className="h-2 w-1/2 rounded-full bg-gray-100" />
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm space-y-2">
                        <div className="h-2 w-20 rounded-full bg-gray-100" />
                        <div className="flex gap-1">
                          <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-600">P</div>
                          <div className="h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center text-[10px] font-bold text-purple-600">E</div>
                          <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center text-[10px] font-bold text-emerald-600">S</div>
                          <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center text-[10px] font-bold text-amber-600">I</div>
                          <div className="h-6 w-6 rounded-full bg-red-100 flex items-center justify-center text-[10px] font-bold text-red-600">T</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile: simplified KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:hidden">
            {[
              { value: '24%', label: 'Content Growth', color: 'border-l-blue-400 bg-blue-50/50 text-blue-700' },
              { value: '18%', label: 'SEO Score', color: 'border-l-purple-400 bg-purple-50/50 text-purple-700' },
              { value: '32%', label: 'Traffic Increase', color: 'border-l-emerald-400 bg-emerald-50/50 text-emerald-700' },
              { value: '5min', label: 'Time to Launch', color: 'border-l-amber-400 bg-amber-50/50 text-amber-700' },
            ].map((stat) => (
              <div
                key={stat.label}
                className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm border-l-4 ${stat.color.split(' ')[0]} ${stat.color.split(' ')[1]}`}
              >
                <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
                <div className="mt-1 text-sm font-medium text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── PROBLEM ─────────────────────────────────────────────────────────────────────

function ProblemSection() {
  const { t } = useTranslation();

  const cards = [
    { emoji: "🧩", title: t.problem_card1_title, text: t.problem_card1_text },
    { emoji: "🤯", title: t.problem_card2_title, text: t.problem_card2_text },
    { emoji: "🧭", title: t.problem_card3_title, text: t.problem_card3_text },
  ];

  return (
    <section id="problem" className="bg-gray-50 py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.problem_headline}</SectionHeading>
          <p className="mt-4 text-lg text-gray-500">{t.problem_text}</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <div className="text-3xl">{card.emoji}</div>
              <h3 className="mt-4 text-lg font-bold text-gray-900">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{card.text}</p>
            </div>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── SOLUTION / FEATURES ─────────────────────────────────────────────────────────

function SolutionSection() {
  const { t } = useTranslation();

  const features = [
    {
      icon: "🎨",
      title: t.feature_image_studio_title,
      desc: t.feature_image_studio_desc,
      tile: "from-blue-500 to-purple-500",
    },
    {
      icon: "🛍️",
      title: t.feature_etsy_seo_title,
      desc: t.feature_etsy_seo_desc,
      tile: "from-amber-500 to-orange-500",
    },
    {
      icon: "📝",
      title: t.feature_blog_title,
      desc: t.feature_blog_desc,
      tile: "from-emerald-500 to-teal-500",
    },
    {
      icon: "📊",
      title: t.feature_strategy_title,
      desc: t.feature_strategy_desc,
      tile: "from-blue-600 to-purple-600",
    },
  ];

  return (
    <section id="features" className="py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.solution_headline}</SectionHeading>
          <p className="mt-4 text-lg text-gray-500">{t.solution_subtitle}</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="group flex flex-col gap-5 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm transition-all hover:border-blue-200 hover:shadow-md hover:-translate-y-0.5 sm:flex-row"
            >
              <div
                className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl text-white shadow-lg transition-transform group-hover:scale-110 ${f.tile}`}
              >
                {f.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-bold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── EXAMPLES ────────────────────────────────────────────────────────────────────

function ExamplesSection() {
  const { t } = useTranslation();

  const etsyTags = t.example_etsy_tags.split("·").map((tag) => tag.trim()).filter(Boolean);

  return (
    <section id="examples" className="bg-gray-50 py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.example_headline}</SectionHeading>
          <p className="mt-4 text-lg text-gray-500">{t.example_subtitle}</p>
        </div>

        {/* Input box */}
        <div className="mx-auto mt-12 max-w-2xl">
          <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm border-l-4 border-l-blue-500">
            <p className="text-sm leading-relaxed text-gray-700 italic">
              {t.example_input}
            </p>
          </div>
        </div>

        {/* Mockups */}
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {/* Pinterest pin mockup */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t.example_pinterest_title}
              </span>
              <span className="text-[10px] font-medium text-gray-300">2:3</span>
            </div>
            <div className="relative flex aspect-[2/3] flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br from-red-500 via-rose-400 to-orange-300 p-6">
              <div className="flex gap-1.5">
                <div className="h-2 w-2 rounded-full bg-white/40" />
                <div className="h-2 w-2 rounded-full bg-white/40" />
                <div className="h-2 w-2 rounded-full bg-white/40" />
              </div>
              <div>
                <p className="text-xl font-extrabold leading-tight text-white">{t.example_pin_headline}</p>
                <p className="mt-3 text-xs leading-relaxed text-white/90">{t.example_pin_desc}</p>
              </div>
              <div className="rounded-lg bg-white/95 px-3 py-2 text-center text-xs font-extrabold tracking-wide text-red-600">
                SAVE
              </div>
            </div>
          </div>

          {/* Etsy listing mockup */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t.example_etsy_title}
              </span>
              <span className="text-[10px] font-medium text-gray-300">4:3</span>
            </div>
            <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-amber-100 via-orange-100 to-yellow-50">
              <div className="absolute inset-0 opacity-60 bg-[radial-gradient(#f59e0b_1px,transparent_1px)] bg-[length:16px_16px]" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white text-4xl shadow-lg shadow-amber-200">
                🦕
              </div>
            </div>
            <div className="mt-3">
              <p className="text-sm font-bold leading-snug text-gray-900">{t.example_etsy_headline}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{t.example_etsy_desc}</p>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {etsyTags.map((tag) => (
                  <span key={tag} className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200/60">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* SEO blog post mockup */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t.example_seo_title}
              </span>
              <span className="text-[10px] font-medium text-gray-300">16:9</span>
            </div>
            <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-100 via-indigo-50 to-purple-100">
              <div className="absolute inset-0 opacity-60 bg-[radial-gradient(#6366f1_1px,transparent_1px)] bg-[length:16px_16px]" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow-lg shadow-indigo-200">
                📝
              </div>
            </div>
            <div className="mt-3">
              <p className="text-sm font-bold leading-snug text-gray-900">{t.example_blog_headline}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{t.example_blog_excerpt}</p>
              <p className="mt-2 text-[10px] font-medium text-gray-400">{t.example_blog_meta}</p>
            </div>
          </div>
        </div>

        <div className="mt-10 text-center">
          <SecondaryButton href="/app/new-project">{t.example_cta}</SecondaryButton>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── HOW IT WORKS ────────────────────────────────────────────────────────────────

function HowItWorksSection() {
  const { t } = useTranslation();

  const steps = [
    { number: "1", title: t.how_step1_title, text: t.how_step1_text },
    { number: "2", title: t.how_step2_title, text: t.how_step2_text },
    { number: "3", title: t.how_step3_title, text: t.how_step3_text },
  ];

  return (
    <section id="how-it-works" className="bg-white py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.how_headline}</SectionHeading>
        </div>
        <div className="mt-16 grid gap-8 sm:grid-cols-3">
          {steps.map((step, idx) => (
            <div key={step.number} className="relative text-center">
              {/* Connector line (desktop only) */}
              {idx < steps.length - 1 && (
                <div className="absolute top-10 left-[60%] hidden h-0.5 w-full bg-gradient-to-r from-blue-200 via-purple-200 to-transparent sm:block" />
              )}
              {/* Step circle */}
              <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-3xl font-extrabold text-white shadow-xl shadow-blue-200">
                {step.number}
              </div>
              <h3 className="mt-6 text-xl font-bold text-gray-900">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-500">{step.text}</p>
            </div>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── DIFFERENTIATION ─────────────────────────────────────────────────────────────

function DifferentiationSection() {
  const { t } = useTranslation();

  const leftItems = [
    t.diff_col1_item1,
    t.diff_col1_item2,
    t.diff_col1_item3,
    t.diff_col1_item4,
  ];

  const rightItems = [
    t.diff_col2_item1,
    t.diff_col2_item2,
    t.diff_col2_item3,
    t.diff_col2_item4,
    t.diff_col2_item5,
  ];

  return (
    <section id="differentiation" className="bg-gray-50 py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.diff_headline}</SectionHeading>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-2">
          {/* Left column: Standard AI-Chat */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8">
            <h3 className="text-xl font-bold text-gray-500">{t.diff_col1_title}</h3>
            <ul className="mt-6 space-y-4">
              {leftItems.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex-shrink-0 text-red-400">
                    <CrossIcon />
                  </span>
                  <span className="text-sm text-gray-500">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right column: Growimo */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-8 shadow-sm shadow-blue-100/50">
            <h3 className="text-xl font-bold text-blue-700">{t.diff_col2_title}</h3>
            <ul className="mt-6 space-y-4">
              {rightItems.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex-shrink-0 text-emerald-500">
                    <CheckIcon />
                  </span>
                  <span className="text-sm font-medium text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── TARGET AUDIENCE ─────────────────────────────────────────────────────────────

function AudienceSection() {
  const { t } = useTranslation();

  const audiences = [
    { emoji: "🛍️", title: t.audience1_title, text: t.audience1_text },
    { emoji: "📌", title: t.audience2_title, text: t.audience2_text },
    { emoji: "📦", title: t.audience3_title, text: t.audience3_text },
    { emoji: "👕", title: t.audience4_title, text: t.audience4_text },
    { emoji: "🎯", title: t.audience5_title, text: t.audience5_text },
    { emoji: "✍️", title: t.audience6_title, text: t.audience6_text },
  ];

  return (
    <section id="audience" className="bg-white py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-3xl text-center">
          <SectionHeading className="text-2xl sm:text-3xl lg:text-4xl">
            {t.audience_headline}
          </SectionHeading>
        </div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {audiences.map((aud) => (
            <div
              key={aud.title}
              className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:border-blue-200 hover:shadow-md hover:-translate-y-0.5"
            >
              <div className="text-3xl transition-transform group-hover:scale-110">{aud.emoji}</div>
              <h3 className="mt-4 text-lg font-bold text-gray-900">{aud.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{aud.text}</p>
            </div>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── START FREE CTA ──────────────────────────────────────────────────────────────

function StartFreeSection() {
  const { t } = useTranslation();

  const benefits = [t.cta_banner_benefit1, t.cta_banner_benefit2, t.cta_banner_benefit3];

  return (
    <section id="start-free" className="bg-gray-50 py-24 sm:py-32">
      <SectionContainer>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-purple-600 to-purple-700 px-6 py-16 sm:px-16 sm:py-24">
          {/* Decorative blurs */}
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/3">
            <div className="h-80 w-80 rounded-full bg-white/10 blur-3xl" />
          </div>
          <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/3">
            <div className="h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
              {t.cta_banner_headline}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-blue-100">
              {t.cta_banner_text}
            </p>

            <ul className="mt-10 space-y-3">
              {benefits.map((benefit) => (
                <li key={benefit} className="flex items-center justify-center gap-3 text-blue-100">
                  <CheckIcon className="h-5 w-5 flex-shrink-0 text-emerald-300" />
                  <span className="text-base">{benefit}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <a
                href="/app/sign-up"
                className="inline-flex items-center justify-center rounded-xl bg-white px-10 py-4 text-base font-bold text-blue-700 shadow-xl shadow-black/10 transition-all hover:bg-gray-50 hover:shadow-2xl hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {t.cta_banner_button}
              </a>
            </div>
          </div>
        </div>
      </SectionContainer>
    </section>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────────────

function FaqSection() {
  const { t } = useTranslation();

  const faqs = [
    { q: t.faq_q1, a: t.faq_a1 },
    { q: t.faq_q2, a: t.faq_a2 },
    { q: t.faq_q3, a: t.faq_a3 },
    { q: t.faq_q4, a: t.faq_a4 },
    { q: t.faq_q5, a: t.faq_a5 },
    { q: t.faq_q6, a: t.faq_a6 },
  ];

  return (
    <section id="faq" className="bg-white py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-3xl text-center">
          <SectionHeading>{t.faq_headline}</SectionHeading>
        </div>
        <div className="mx-auto mt-14 max-w-3xl space-y-4">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-2xl border border-gray-200 bg-white p-6 transition-all hover:border-blue-200 open:border-blue-200 open:shadow-sm"
            >
              <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-gray-900 marker:content-none">
                {faq.q}
                <ChevronDownIcon className="h-5 w-5 flex-shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-4 text-gray-600 leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>
      </SectionContainer>
    </section>
  );
}

// ── FINAL CTA ───────────────────────────────────────────────────────────────────

function FinalCtaSection() {
  const { t } = useTranslation();

  return (
    <section className="bg-gray-50 py-24 sm:py-32">
      <SectionContainer>
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading>{t.cta_final_headline}</SectionHeading>
          <p className="mt-4 text-lg text-gray-500">{t.cta_final_text}</p>
          <div className="mt-10">
            <PrimaryButton href="/app/sign-up">{t.cta_final_button}</PrimaryButton>
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
    { label: t.nav_features, href: "#features" },
    { label: t.nav_how_it_works, href: "#how-it-works" },
    { label: t.nav_examples, href: "#examples" },
    { label: t.nav_audience, href: "#audience" },
    { label: t.nav_faq, href: "#faq" },
  ];

  const legalLinks = [
    { label: t.footer_privacy, href: "#" },
    { label: t.footer_imprint, href: "#" },
    { label: t.footer_terms, href: "#" },
    { label: t.footer_contact, href: "mailto:hello@growimo.app" },
  ];

  return (
    <footer className="border-t border-gray-200 bg-white py-12">
      <SectionContainer>
        <div className="grid gap-10 sm:grid-cols-3">
          {/* Logo + description */}
          <div>
            <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Growimo" className="h-8 w-auto" />
              </div>
            <p className="mt-4 text-sm leading-relaxed text-gray-500">
              {t.footer_description}
            </p>
          </div>

          {/* Feature links */}
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

          {/* Legal links */}
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

        {/* Bottom */}
        <div className="mt-10 border-t border-gray-100 pt-6">
          <p className="text-xs leading-relaxed text-gray-400">
            {t.footer_disclaimer}
          </p>
          <p className="mt-4 text-sm text-gray-400">
            {t.footer_copyright}
          </p>
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
      <ProblemSection />
      <SolutionSection />
      <ExamplesSection />
      <HowItWorksSection />
      <DifferentiationSection />
      <AudienceSection />
      <StartFreeSection />
      <FaqSection />
      <FinalCtaSection />
      <Footer />
    </div>
  );
}

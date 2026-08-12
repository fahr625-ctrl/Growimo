export const schemaSQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  clerk_id TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  product_idea TEXT,
  content_types JSONB DEFAULT '[]',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  favorite BOOLEAN DEFAULT false,
  versions JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS generated_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('pinterest_pin', 'etsy_listing', 'seo_blog', 'social_post', 'email_newsletter', 'marketing_plan', 'product_idea', 'trend_insight')),
  title TEXT,
  body TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beta_signups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name TEXT NOT NULL,
  email TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_tier TEXT DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_content_project_id ON generated_content(project_id);
CREATE INDEX IF NOT EXISTS idx_generated_content_user_id ON generated_content(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
-- F8 Veröffentlichungs-Kalender: automatischer Publish-Plan je Nutzer/Asset
CREATE TABLE IF NOT EXISTS publish_plan (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES generated_content(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  priority_score INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  best_time TEXT,
  tasks JSONB DEFAULT '[]',
  title TEXT,
  rationale TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_publish_plan_user_date ON publish_plan(user_id, scheduled_date);

-- F9 Performance-Feedback-Loop: Nutzer erfasst echte Ergebnisse je Asset
-- (Impressions, Saves, Klicks, Views, Favoriten, Bestellungen, Ranking, Opens).
-- Deterministische Analyse korreliert diese Werte mit Asset-Merkmalen. Die
-- Erkenntnisse fließen als Kontext in zukünftige Generierungen ein.
CREATE TABLE IF NOT EXISTS performance_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES generated_content(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  metrics JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_perf_entries_user_date ON performance_entries(user_id, published_at);

-- F10 Persönliche Lernschleife: Like/Dislike-Feedback je Nutzer steuert Ton &
-- Format künftiger Generierungen. Die Präferenz-Ableitung ist deterministisch
-- (kein LLM): feedback_assets hält die letzten Bewertungen (Dedupe je Asset),
-- likes/dislikes + tone_profile/format_profile/channel_affinity werden daraus
-- aggregiert. Stichproben-Gate: erst ab >= 3 Signalen wird gesteuert.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  tone_profile JSONB NOT NULL DEFAULT '{}',
  format_profile JSONB NOT NULL DEFAULT '{}',
  channel_affinity JSONB NOT NULL DEFAULT '{}',
  feedback_assets JSONB NOT NULL DEFAULT '[]',
  rule_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Migrations for pre-existing databases ────────────────────────────────────
-- These are idempotent: they run on every init so an existing DB created before
-- these columns/constraints existed is brought up to date without dropping data.

-- favorite + versions on projects (added for the PostgreSQL store migration)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS versions JSONB DEFAULT '[]';

-- metadata on projects (F6 Strategie-Brief etc. — optional project-level data)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Allow the two analysis content types in generated_content
-- (marketing_analysis and market_intelligence are generated by the AI engine).
ALTER TABLE generated_content DROP CONSTRAINT IF EXISTS generated_content_content_type_check;
ALTER TABLE generated_content ADD CONSTRAINT generated_content_content_type_check CHECK (content_type IN ('pinterest_pin', 'etsy_listing', 'seo_blog', 'social_post', 'email_newsletter', 'marketing_plan', 'product_idea', 'trend_insight', 'marketing_analysis', 'market_intelligence'));

-- approved on beta_signups (beta access gate: every signup is auto-approved)
ALTER TABLE beta_signups ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT TRUE;
`;

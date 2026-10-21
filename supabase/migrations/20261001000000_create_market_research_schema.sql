-- Core relational schema for App Competition Analysis.
-- Every row receives a real UUID primary key. mock_id is an optional stable
-- fixture key used to upsert seeded data and resolve mock foreign-key refs.
-- When Supabase Auth is added, auth_user_id links a profile to auth.users.

create table public.users (
  id uuid primary key default gen_random_uuid(),
  mock_id text unique,
  auth_user_id uuid unique references auth.users (id) on delete cascade,
  name text not null,
  email text,
  initials text not null,
  created_at timestamptz not null default now()
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  mock_id text unique,
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  description text not null check (char_length(description) between 15 and 500),
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  mock_id text unique,
  idea_id uuid not null references public.ideas (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  similar_app_count integer not null default 0 check (similar_app_count >= 0),
  reviews_scanned_count integer not null default 0 check (reviews_scanned_count >= 0),
  sentiment_group_count integer not null default 0 check (sentiment_group_count between 0 and 3),
  top_gap text,
  source text not null default 'mock' check (source in ('mock', 'web_search')),
  category text not null default 'general'
    check (category in ('meal', 'budget', 'fitness', 'general')),
  created_at timestamptz not null default now()
);

create table public.analysis_competitors (
  id uuid primary key default gen_random_uuid(),
  mock_id text unique,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  app_name text not null,
  subtitle text,
  platform text,
  relevance_reason text,
  app_url text,
  icon text,
  rank integer not null check (rank > 0),
  rating numeric(2, 1) check (rating between 0 and 5),
  match_percent integer check (match_percent between 0 and 100),
  unique (analysis_id, rank)
);

create table public.review_themes (
  id uuid primary key default gen_random_uuid(),
  mock_id text unique,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  sentiment text not null check (sentiment in ('positive', 'average', 'negative')),
  summary text not null,
  example_review text,
  mentions integer not null default 0 check (mentions >= 0),
  prevalence numeric(5, 2) check (prevalence between 0 and 100),
  rank integer not null check (rank > 0),
  unique (analysis_id, sentiment, rank)
);

create index ideas_user_created_idx on public.ideas (user_id, created_at desc);
create index analyses_idea_created_idx on public.analyses (idea_id, created_at desc);
create index analysis_competitors_analysis_rank_idx on public.analysis_competitors (analysis_id, rank);
create index review_themes_analysis_sentiment_rank_idx on public.review_themes (analysis_id, sentiment, rank);

-- These tables will eventually contain user-owned research. Keep direct API
-- access closed until Supabase Auth and ownership policies are implemented.
alter table public.users enable row level security;
alter table public.ideas enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_competitors enable row level security;
alter table public.review_themes enable row level security;

comment on table public.users is 'Seed users are illustrative. mock_id is an optional fixture key; auth_user_id can link a profile to Supabase Auth later.';
comment on column public.users.mock_id is 'Nullable deterministic fixture key. Production-created rows leave this null.';
comment on column public.ideas.mock_id is 'Nullable deterministic fixture key used to resolve seeded user relationships.';
comment on column public.analyses.mock_id is 'Nullable deterministic fixture key used to resolve seeded idea relationships.';
comment on column public.analysis_competitors.mock_id is 'Nullable deterministic fixture key used to make fixture seeding idempotent.';
comment on column public.review_themes.mock_id is 'Nullable deterministic fixture key used to make fixture seeding idempotent.';
comment on table public.ideas is 'A user-submitted app idea or market description.';
comment on table public.analyses is 'One research run for an idea; an idea may have multiple analysis snapshots.';
comment on table public.analysis_competitors is 'Ranked competitor candidates found for one analysis.';
comment on table public.review_themes is 'A summarized review theme grouped by sentiment for one analysis.';
